import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';

dotenv.config();

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: false });
const NITTER_URL = 'https://nitter.net/BarcaUniversal';
const LAST_TWEET_FILE = 'last_tweet_id.txt';
const INTERVAL_MINUTES = 15;

function loadLastTweetId() {
    try {
        return fs.readFileSync(LAST_TWEET_FILE, 'utf8').trim();
    } catch {
        return null;
    }
}

function saveLastTweetId(id) {
    try {
        fs.writeFileSync(LAST_TWEET_FILE, id, 'utf8');
    } catch (err) {
        console.error('❌ Ошибка сохранения last tweet id:', err);
    }
}

let lastTweetId = loadLastTweetId();
let isFirstRun = lastTweetId === null;

async function checkTweets() {
    try {
        const res = await fetch(NITTER_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });

        if (res.status === 429) {
            console.warn('⚠️ Слишком много запросов к Nitter — сервер заблокировал на время.');
            return;
        }
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);

        const html = await res.text();
        const $ = cheerio.load(html);

        const tweets = [];

        $('.timeline-item').each((i, el) => {
            const href = $(el).find('a.tweet-link').attr('href');
            if (!href) return;

            const match = href.match(/status\/(\d+)/);
            if (!match) return;
            const tweetId = match[1];

            const text = $(el).find('.tweet-content').text().trim();
            const tweetUrl = `https://nitter.net${href.split('#')[0]}`;

            tweets.push({ tweetId, text, tweetUrl });
        });

        if (!tweets.length) {
            console.log('⚠️ Твиты не найдены на странице.');
            return;
        }

        // Отсортируем по возрастанию — старые впереди
        tweets.reverse();

        // При первом запуске присылаем последние 5 твитов, иначе только новые с момента lastTweetId
        let newTweets;

        if (isFirstRun) {
            newTweets = tweets.slice(-5); // последние 5
            isFirstRun = false;
        } else {
            // Берём только твиты, которые идут после lastTweetId
            const index = tweets.findIndex(t => t.tweetId === lastTweetId);
            newTweets = index === -1 ? tweets : tweets.slice(index + 1);
        }

        if (newTweets.length === 0) {
            console.log('ℹ️ Новых твитов нет.');
            return;
        }

        for (const tweet of newTweets) {
            const message = `🐦 <b>Новый твит от BarcaUniversal</b>\n\n${tweet.text}\n\n🔗 <a href="${tweet.tweetUrl}">Открыть в браузере</a>`;
            await bot.sendMessage(process.env.TELEGRAM_CHAT_ID, message, { parse_mode: 'HTML' });
            lastTweetId = tweet.tweetId;
            saveLastTweetId(lastTweetId);
        }

    } catch (err) {
        console.error('❌ Ошибка при получении твитов:', err.message || err);
    }
}

console.log('🔔 Бот запущен и слушает твиты через Nitter...');
checkTweets();
setInterval(checkTweets, INTERVAL_MINUTES * 60 * 1000);
