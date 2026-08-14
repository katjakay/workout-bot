const { Telegraf, Markup, session } = require('telegraf');
const { Client } = require('@notionhq/client');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

// State management
const userNames = {};
const pendingProposals = {};

// Middleware
bot.use(session());

// Extract IDs from link
function extractActivityIds(url) {
  const params = new URL(url).searchParams;
  return {
    activityId: params.get('activityId'),
    activityDateId: params.get('activityDateId'),
  };
}

// START
bot.start((ctx) => {
  ctx.reply(
    '🏃 **Workout Proposal Tracker**\n\n' +
      'Share myclubs links and track who\'s going!\n\n' +
      '/register - Set your name\n' +
      '/list - See all proposals\n\n' +
      'Then:\n' +
      '1. Send a myclubs link\n' +
      '2. Tell me the class name & time\n' +
      '3. Share /list with friends\n' +
      '4. Friends tap buttons to join!',
    { parse_mode: 'Markdown' }
  );
});

// REGISTER
bot.command('register', async (ctx) => {
  ctx.session.registering = true;
  await ctx.reply('What\'s your name?');
});

// LIST
bot.command('list', async (ctx) => {
  try {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
    });

    if (response.results.length === 0) {
      await ctx.reply('📋 No proposals yet');
      return;
    }

    let text = '📋 **Proposals:**\n\n';
    const buttons = [];

    response.results.forEach((page, i) => {
      const name = page.properties.Name?.title[0]?.text?.content || 'Untitled';
      const link = page.properties.Link?.url || '';
      const interested = page.properties.Interested?.multi_select?.map(s => s.name).join(', ') || '-';
      const confirmed = page.properties.Confirmed?.multi_select?.map(s => s.name).join(', ') || '-';

      text += `${i + 1}️⃣ ${name}\n`;
      if (link) text += `🔗 [myclubs](${link})\n`;
      text += `👍 ${interested}\n✅ ${confirmed}\n\n`;
      
      buttons.push([
        Markup.button.callback(`👍 In`, `in_${i}`),
        Markup.button.callback(`✅ Confirmed`, `confirm_${i}`),
        Markup.button.callback(`❌ Out`, `out_${i}`),
      ]);
    });

    buttons.push([Markup.button.callback('🔄', 'refresh')]);

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    });
  } catch (err) {
    console.error('List error:', err);
    await ctx.reply('❌ Error');
  }
});

// BUTTON: Interested
bot.action(/^in_(\d+)$/, async (ctx) => {
  try {
    const num = parseInt(ctx.match[1]);
    const name = userNames[ctx.from.id] || 'Unknown';

    const response = await notion.databases.query({ database_id: DATABASE_ID });
    const page = response.results[num];

    if (!page) {
      await ctx.answerCbQuery('❌ Proposal not found');
      return;
    }

    const current = page.properties.Interested?.multi_select || [];
    const exists = current.find(s => s.name === name);

    if (!exists) {
      await notion.pages.update({
        page_id: page.id,
        properties: {
          Interested: {
            multi_select: [...current, { name }],
          },
        },
      });
    }

    await ctx.answerCbQuery(`✅ ${name} interested!`);
  } catch (err) {
    console.error('Interested error:', err);
    await ctx.answerCbQuery('❌ Error');
  }
});

// BUTTON: Confirm
bot.action(/^confirm_(\d+)$/, async (ctx) => {
  try {
    const num = parseInt(ctx.match[1]);
    const name = userNames[ctx.from.id] || 'Unknown';

    const response = await notion.databases.query({ database_id: DATABASE_ID });
    const page = response.results[num];

    if (!page) {
      await ctx.answerCbQuery('❌ Proposal not found');
      return;
    }

    const current = page.properties.Confirmed?.multi_select || [];
    const exists = current.find(s => s.name === name);

    if (!exists) {
      await notion.pages.update({
        page_id: page.id,
        properties: {
          Confirmed: {
            multi_select: [...current, { name }],
          },
        },
      });
    }

    await ctx.answerCbQuery(`✅ ${name} confirmed!`);
  } catch (err) {
    console.error('Confirm error:', err);
    await ctx.answerCbQuery('❌ Error');
  }
});

// BUTTON: Remove
bot.action(/^out_(\d+)$/, async (ctx) => {
  try {
    const num = parseInt(ctx.match[1]);
    const name = userNames[ctx.from.id] || 'Unknown';

    const response = await notion.databases.query({ database_id: DATABASE_ID });
    const page = response.results[num];

    if (!page) {
      await ctx.answerCbQuery('❌ Proposal not found');
      return;
    }

    await notion.pages.update({
      page_id: page.id,
      properties: {
        Interested: {
          multi_select: (page.properties.Interested?.multi_select || []).filter(s => s.name !== name),
        },
        Confirmed: {
          multi_select: (page.properties.Confirmed?.multi_select || []).filter(s => s.name !== name),
        },
      },
    });

    await ctx.answerCbQuery(`${name} removed`);
  } catch (err) {
    console.error('Out error:', err);
    await ctx.answerCbQuery('❌ Error');
  }
});

// BUTTON: Refresh
bot.action('refresh', (ctx) => {
  ctx.scene.leave?.();
  return ctx.command('list');
});

// TEXT HANDLER
bot.on('text', async (ctx) => {
  try {
    // Initialize session
    if (!ctx.session) ctx.session = {};

    // Registering
    if (ctx.session?.registering) {
      userNames[ctx.from.id] = ctx.message.text.trim();
      ctx.session.registering = false;
      await ctx.reply(`✅ Registered as ${userNames[ctx.from.id]}`);
      return;
    }

    // Check for myclubs link
    const link = ctx.message.text.match(/https:\/\/www\.myclubs\.com\/.*joinme.*/i);
    if (link) {
      ctx.session.pendingLink = link[0];
      ctx.session.pendingIds = extractActivityIds(link[0]);
      await ctx.reply('Class name & time? (e.g., "Yoga 6pm Wed")');
      return;
    }

    // Saving proposal
    if (ctx.session?.pendingLink) {
      const classInfo = ctx.message.text.trim();
      const name = userNames[ctx.from.id] || 'Unknown';

      const ids = ctx.session.pendingIds;

      // Check if exists
      const existing = await notion.databases.query({
        database_id: DATABASE_ID,
        filter: {
          property: 'Activity ID',
          rich_text: { equals: ids.activityId },
        },
      });

      if (existing.results.length > 0) {
        // Update existing
        const page = existing.results[0];
        const current = page.properties.Interested?.multi_select || [];
        
        await notion.pages.update({
          page_id: page.id,
          properties: {
            Interested: {
              multi_select: [...current, { name }],
            },
          },
        });

        await ctx.reply(`✅ Added to: ${classInfo}`);
      } else {
        // Create new
        await notion.pages.create({
          parent: { database_id: DATABASE_ID },
          properties: {
            Name: { title: [{ text: { content: classInfo } }] },
            Link: { url: ctx.session.pendingLink },
            'Activity ID': { rich_text: [{ text: { content: ids.activityId } }] },
            'Activity Date ID': { rich_text: [{ text: { content: ids.activityDateId } }] },
            Interested: { multi_select: [{ name }] },
          },
        });

        await ctx.reply(`✅ Proposal created: ${classInfo}\n👍 You\'re interested!`);
      }

      ctx.session.pendingLink = null;
      ctx.session.pendingIds = null;
    }
  } catch (err) {
    console.error('Text handler error:', err);
    await ctx.reply('❌ Error: ' + err.message);
  }
});

// ERROR HANDLER
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
});

// LAUNCH
bot.launch();
console.log('🤖 Bot running...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
