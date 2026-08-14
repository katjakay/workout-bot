const { Telegraf, Markup, session } = require('telegraf');
const { Client } = require('@notionhq/client');
const puppeteer = require('puppeteer');

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

// State management
const userNames = {};
const pendingProposals = {};

// Middleware
bot.use(session());

// Scrape myclubs page to extract class details
async function scrapeClassDetails(url) {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 10000 });

    // Extract class name, time, location from rendered page
    const classData = await page.evaluate(() => {
      const titleEl = document.querySelector('h1') || document.querySelector('[class*="title"]');
      const timeEl = document.querySelector('[class*="time"]') || document.querySelector('[class*="date"]');
      const locationEl = document.querySelector('[class*="location"]') || document.querySelector('[class*="studio"]');

      return {
        name: titleEl?.textContent?.trim() || 'Workout',
        time: timeEl?.textContent?.trim() || 'TBD',
        location: locationEl?.textContent?.trim() || '',
      };
    });

    await browser.close();
    return classData;
  } catch (err) {
    console.error('Scrape error:', err);
    if (browser) await browser.close();
    return null;
  }
}

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

    await ctx.reply('📋 **Active Proposals:**', { parse_mode: 'Markdown' });

    // Send each proposal as its own message with buttons
    response.results.forEach((page, i) => {
      const name = page.properties.Name?.title[0]?.text?.content || 'Untitled';
      const link = page.properties.Link?.url || '';
      const interested = page.properties.Interested?.multi_select?.map(s => s.name).join(', ') || '-';
      const confirmed = page.properties.Confirmed?.multi_select?.map(s => s.name).join(', ') || '-';

      let text = `${i + 1}️⃣ ${name}\n`;
      if (link) text += `🔗 [myclubs](${link})\n`;
      text += `👍 ${interested}\n✅ ${confirmed}`;

      const buttons = [
        [
          Markup.button.callback(`👍 In`, `in_${i}`),
          Markup.button.callback(`✅ Confirmed`, `confirm_${i}`),
          Markup.button.callback(`❌ Out`, `out_${i}`),
        ],
      ];

      // Send with a small delay so messages appear in order
      setTimeout(() => {
        ctx.reply(text, {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
        });
      }, i * 500);
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

    const interested = (page.properties.Interested?.multi_select || []).filter(s => s.name !== name);
    const confirmed = (page.properties.Confirmed?.multi_select || []).filter(s => s.name !== name);

    await notion.pages.update({
      page_id: page.id,
      properties: {
        Interested: {
          multi_select: [...interested, { name }],
        },
        Confirmed: {
          multi_select: confirmed,
        },
      },
    });

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

    const interested = (page.properties.Interested?.multi_select || []).filter(s => s.name !== name);
    const confirmed = (page.properties.Confirmed?.multi_select || []).filter(s => s.name !== name);

    await notion.pages.update({
      page_id: page.id,
      properties: {
        Interested: {
          multi_select: interested,
        },
        Confirmed: {
          multi_select: [...confirmed, { name }],
        },
      },
    });

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
      const fullLink = link[0];
      const ids = extractActivityIds(fullLink);
      const name = userNames[ctx.from.id] || 'Unknown';

      // Show loading message
      await ctx.reply('⏳ Extracting class details...');

      // Scrape the page
      const classDetails = await scrapeClassDetails(fullLink);
      
      if (!classDetails) {
        await ctx.reply('❌ Could not extract class details. Try again or share manually.');
        return;
      }

      const classInfo = `${classDetails.name}, ${classDetails.time}`;

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

        await ctx.reply(`✅ Added to: ${classInfo}\n👍 ${name} is interested!`);
      } else {
        // Create new
        await notion.pages.create({
          parent: { database_id: DATABASE_ID },
          properties: {
            Name: { title: [{ text: { content: classInfo } }] },
            Link: { url: fullLink },
            'Activity ID': { rich_text: [{ text: { content: ids.activityId } }] },
            'Activity Date ID': { rich_text: [{ text: { content: ids.activityDateId } }] },
            Interested: { multi_select: [{ name }] },
          },
        });

        await ctx.reply(`✅ Proposal created: ${classInfo}\n👍 ${name} is interested!`);
      }
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
