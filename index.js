// twitter_telegram_bot/index.js

import dotenv from 'dotenv';
import { TwitterApi } from 'twitter-api-v2';
import TelegramBot from 'node-telegram-bot-api';
import translate from '@iamtraction/google-translate';

dotenv.config();

const twitter = new TwitterApi(process.env.TWITTER_BEARER_TOKEN);
const roClient = twitter.readOnly;

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, {
    polling: true,
    baseApiUrl: process.env.TELEGRAM_API_URL || 'https://api.telegram.org',
});

const TWITTER_USER_ID = process.env.TWITTER_USERID;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let lastSentId = null;

async function fetchTweets(count = 5) {
    try {
        const timeline = await roClient.v2.userTimeline(TWITTER_USER_ID, {
            max_results: count,
            'tweet.fields': ['created_at', 'text'],
            exclude: 'replies',
        });
        return timeline?.data?.data || [];
    } catch (err) {
        if (err.code === 429) {
            const reset = err.rateLimit?.reset
                ? new Date(err.rateLimit.reset * 1000).toLocaleTimeString()
                : 'неизвестно когда';
            console.warn(`⚠️ Превышен лимит запросов. Следующий доступ ${reset}`);
        } else {
            console.error('Ошибка при получении твитов:', err);
        }
        return [];
    }
}

async function checkAndSend() {
    try {
        const tweets = await fetchTweets(10); // читаем чуть больше, чтобы не пропустить твиты

        if (!Array.isArray(tweets)) {
            console.error('❌ Tweets не массив:', tweets);
            return;
        }

        // От старых к новым
        for (const tweet of tweets.reverse()) {
            if (lastSentId && BigInt(tweet.id) <= BigInt(lastSentId)) continue;

            let translated = '';
            try {
                const res = await translate(tweet.text, { to: 'ru' });
                translated = res.text;
            } catch (transErr) {
                console.error('Ошибка перевода:', transErr);
            }

            const msg = `🕓 ${tweet.created_at}

📌 *Оригинал:*
${tweet.text}

🌐 *Перевод:*
${translated}`;
            await bot.sendMessage(TG_CHAT_ID, msg, { parse_mode: 'Markdown' });
            lastSentId = tweet.id;
        }
    } catch (err) {
        console.error('Ошибка в checkAndSend():', err);
    }
}

bot.sendMessage(TG_CHAT_ID, '🚀 Бот запущен!');

(async () => {
    const latest = await fetchTweets(5);
    if (latest.length > 0) {
        lastSentId = latest[0].id;
        console.log(`🔰 Запуск. Последний твит: ${lastSentId}`);
    }

    setInterval(checkAndSend, 15 * 60 * 1000);
    checkAndSend();
})();
