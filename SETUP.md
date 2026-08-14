# Workout Proposal Bot - Setup Guide

## Option 1: Run Locally (Quick Test)

```bash
# Install dependencies
npm install

# Start the bot
npm start
```

Bot runs locally until you stop it (Ctrl+C).

## Option 2: Deploy on Railway (Recommended)

1. Go to https://railway.app
2. Create account (GitHub login is easiest)
3. Create new project → Import from GitHub
4. Select this repo (or create new)
5. Add environment variables:
   - `TELEGRAM_TOKEN`: `:`
   - `NOTION_TOKEN`: `ntn_`
   - `NOTION_DATABASE_ID`: ``
6. Deploy
7. Bot runs 24/7

## Option 3: Deploy on Vercel (Alternative)

Create `vercel.json`:
```json
{
  "functions": {
    "workout-bot.js": {
      "memory": 1024,
      "maxDuration": 60
    }
  }
}
```

Then deploy with `vercel` CLI.

## How to Use

### 1. Register (everyone does this once)
```
/register
→ "What's your name?"
→ reply: "Alex"
```

### 2. Share a myclubs link in the group
```
"Hey check this out: https://www.myclubs.com/at/en/joinme/3/?activityId=xvfDiLb5w2&activityDateId=cuebC4Vle5"
```

Bot responds:
```
"What's the class name and time? (e.g., "Yoga 6pm Wed")"
```

Reply:
```
"Yoga 6pm Wed"
```

Bot creates the proposal in Notion and marks you as "Interested"

### 3. View all proposals
```
/list
```

Shows all active proposals with who's interested vs confirmed.

### 4. Mark yourself confirmed
When you actually book in myclubs:
```
/confirm [number]
```
(e.g., `/confirm 1`)

### 5. Mark interested
```
/in [number]
```

### 6. Remove yourself
```
/out [number]
```

## Notes

- Each friend needs to `/register` once
- The bot auto-dedupes if the same activity ID is sent twice
- Notion database updates in real-time
- Refresh the bot's `/list` message manually (it won't auto-update)

## Troubleshooting
**Bot not responding?**
- Check Telegram bot token is correct
- Make sure bot is running: `npm start`

**Notion not updating?**
- Check API token has "Read" + "Update" permissions on the database
- Verify database ID is correct

**Links not being recognized?**
- Make sure the myclubs link format is: `https://www.myclubs.com/at/en/joinme/3/?activityId=XXX&activityDateId=YYY`
