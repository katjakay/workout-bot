const { Telegraf, Markup } = require('telegraf');
const { Client } = require('@notionhq/client');
const axios = require('axios');

// Initialize
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

// Extract activity IDs from myclubs link
function extractActivityIds(url) {
  const params = new URL(url).searchParams;
  return {
    activityId: params.get('activityId'),
    activityDateId: params.get('activityDateId'),
  };
}

// Register user
bot.command('register', async (ctx) => {
  await ctx.reply('What\'s your name? (reply with just your name)');
  ctx.session = ctx.session || {};
  ctx.session.registering = true;
});

// Handle registration input
bot.on('text', async (ctx) => {
  if (ctx.session?.registering) {
    const name = ctx.message.text.trim();
    ctx.session.userName = name;
    ctx.session.registering = false;
    await ctx.reply(`✅ Registered as ${name}!`);
    return;
  }

  // Check if message is a myclubs link
  const myclubsLink = ctx.message.text.match(/https:\/\/www\.myclubs\.com\/.*joinme.*/i);
  
  if (myclubsLink) {
    ctx.session = ctx.session || {};
    ctx.session.pendingLink = myclubsLink[0];
    ctx.session.pendingIds = extractActivityIds(myclubsLink[0]);
    await ctx.reply('What\'s the class name and time? (e.g., "Yoga 6pm Wed")');
  }
});

// When class name is provided, save to Notion
bot.on('text', async (ctx) => {
  if (ctx.session?.pendingLink && !ctx.session?.registering) {
    const classInfo = ctx.message.text.trim();
    const userName = ctx.session.userName || 'Unknown';

    try {
      // Check if proposal already exists
      const existing = await notion.databases.query({
        database_id: DATABASE_ID,
        filter: {
          property: 'Activity ID',
          rich_text: {
            equals: ctx.session.pendingIds.activityId,
          },
        },
      });

      let pageId;
      if (existing.results.length > 0) {
        // Update existing
        pageId = existing.results[0].id;
        await notion.pages.update({
          page_id: pageId,
          properties: {
            Interested: {
              multi_select: [
                ...(existing.results[0].properties.Interested?.multi_select || []),
                { name: userName },
              ],
            },
          },
        });
      } else {
        // Create new proposal
        const response = await notion.pages.create({
          parent: { database_id: DATABASE_ID },
          properties: {
            Name: { title: [{ text: { content: classInfo } }] },
            Link: { url: ctx.session.pendingLink },
            'Activity ID': {
              rich_text: [{ text: { content: ctx.session.pendingIds.activityId } }],
            },
            'Activity Date ID': {
              rich_text: [{ text: { content: ctx.session.pendingIds.activityDateId } }],
            },
            Interested: {
              multi_select: [{ name: userName }],
            },
          },
        });
        pageId = response.id;
      }

      await ctx.reply(
        `✅ Added proposal: ${classInfo}\n👍 ${userName} is interested!`
      );

      ctx.session.pendingLink = null;
      ctx.session.pendingIds = null;

      // Show updated list
      await showProposals(ctx);
    } catch (error) {
      console.error('Error saving to Notion:', error);
      await ctx.reply('❌ Error saving proposal. Try again.');
    }
  }
});

// Store proposals in memory for button callbacks
let proposalsCache = {};

// List all proposals with buttons
bot.command('list', showProposals);

async function showProposals(ctx) {
  try {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
    });

    if (response.results.length === 0) {
      await ctx.reply('📋 No active proposals yet.');
      return;
    }

    proposalsCache = {}; // Reset cache
    const keyboard = [];

    response.results.forEach((page, index) => {
      const name = page.properties.Name?.title[0]?.text?.content || 'Untitled';
      const interested =
        page.properties.Interested?.multi_select?.map((s) => s.name).join(', ') ||
        'None';
      const confirmed =
        page.properties.Confirmed?.multi_select?.map((s) => s.name).join(', ') ||
        'None';

      const num = index + 1;
      proposalsCache[num] = { pageId: page.id, name };

      // Create message for this proposal
      const msg = `${num}️⃣ ${name}\n👍 Interested: ${interested}\n✅ Confirmed: ${confirmed}`;
      
      // Add buttons for this proposal
      keyboard.push([
        Markup.button.callback(`👍 ${num}`, `interested_${num}`),
        Markup.button.callback(`✅ ${num}`, `confirm_${num}`),
        Markup.button.callback(`❌ ${num}`, `out_${num}`),
      ]);
    });

    // Build full message
    let fullMessage = '📋 **Active Proposals:**\n\n';
    Object.entries(proposalsCache).forEach((key) => {
      const index = parseInt(key[0]);
      const page = response.results[index - 1];
      const name = page.properties.Name?.title[0]?.text?.content || 'Untitled';
      const interested =
        page.properties.Interested?.multi_select?.map((s) => s.name).join(', ') ||
        'None';
      const confirmed =
        page.properties.Confirmed?.multi_select?.map((s) => s.name).join(', ') ||
        'None';

      fullMessage += `${index}️⃣ ${name}\n👍 ${interested}\n✅ ${confirmed}\n\n`;
    });

    keyboard.push([Markup.button.callback('🔄 Refresh', 'refresh_list')]);

    await ctx.reply(fullMessage, {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard(keyboard).reply_markup,
    });
  } catch (error) {
    console.error('Error fetching proposals:', error);
    await ctx.reply('❌ Error fetching proposals.');
  }
}

// Button handlers
bot.action(/interested_(\d+)/, async (ctx) => {
  const num = ctx.match[1];
  const userName = ctx.session?.userName || 'Unknown';
  
  try {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
    });
    const page = response.results[num - 1];
    
    await notion.pages.update({
      page_id: page.id,
      properties: {
        Interested: {
          multi_select: [
            ...(page.properties.Interested?.multi_select || []),
            { name: userName },
          ],
        },
      },
    });
    
    await ctx.answerCbQuery(`✅ ${userName} marked as interested!`);
    await showProposals(ctx);
  } catch (error) {
    console.error('Error:', error);
    await ctx.answerCbQuery('❌ Error');
  }
});

bot.action(/confirm_(\d+)/, async (ctx) => {
  const num = ctx.match[1];
  const userName = ctx.session?.userName || 'Unknown';
  
  try {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
    });
    const page = response.results[num - 1];
    
    await notion.pages.update({
      page_id: page.id,
      properties: {
        Confirmed: {
          multi_select: [
            ...(page.properties.Confirmed?.multi_select || []),
            { name: userName },
          ],
        },
      },
    });
    
    await ctx.answerCbQuery(`✅ ${userName} confirmed!`);
    await showProposals(ctx);
  } catch (error) {
    console.error('Error:', error);
    await ctx.answerCbQuery('❌ Error');
  }
});

bot.action(/out_(\d+)/, async (ctx) => {
  const num = ctx.match[1];
  const userName = ctx.session?.userName || 'Unknown';
  
  try {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
    });
    const page = response.results[num - 1];
    
    const interested = page.properties.Interested?.multi_select || [];
    const confirmed = page.properties.Confirmed?.multi_select || [];
    
    await notion.pages.update({
      page_id: page.id,
      properties: {
        Interested: {
          multi_select: interested.filter((s) => s.name !== userName),
        },
        Confirmed: {
          multi_select: confirmed.filter((s) => s.name !== userName),
        },
      },
    });
    
    await ctx.answerCbQuery(`${userName} removed`);
    await showProposals(ctx);
  } catch (error) {
    console.error('Error:', error);
    await ctx.answerCbQuery('❌ Error');
  }
});

// Start command
bot.start((ctx) => {
  ctx.reply(
    '🏃 **Workout Proposal Tracker**\n\n' +
      'Share a myclubs link and I\'ll add it to the group\'s proposals!\n\n' +
      '/register - Set your name\n' +
      '/list - See all proposals\n\n' +
      'Commands:\n' +
      '/in [number] - Mark yourself interested\n' +
      '/confirm [number] - Mark yourself confirmed\n' +
      '/out [number] - Remove yourself',
    { parse_mode: 'Markdown' }
  );
});

// Button callbacks
bot.action('refresh_list', showProposals);

// Error handling
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}`, err);
});

// Launch
bot.launch();
console.log('🤖 Workout bot is running...');

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
