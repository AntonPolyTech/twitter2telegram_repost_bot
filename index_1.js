import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';

dotenv.config();

const bot = new TelegramBot(process.env.OOC_TELEGRAM_TOKEN, { polling: false });
const NITTER_URL = 'https://nitter.net/nocontextfooty';
const LAST_TWEET_FILE = 'last_tweet_id.txt';
const INTERVAL_MINUTES = 30;

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
            const isPinned = $(el).find('.icon-pin').length > 0;
            if (isPinned) {
                console.log('📌 Пропущен закреплённый твит');
                return;
            }

            const href = $(el).find('a.tweet-link').attr('href');
            if (!href) return;

            const match = href.match(/status\/(\d+)/);
            if (!match) return;
            const tweetId = match[1];

            const text = $(el).find('.tweet-content').text().trim();

            const imageUrls = [];
            $(el).find('.attachments .attachment.image img').each((i, imgEl) => {
                const src = $(imgEl).attr('src');
                if (src && src.startsWith('/pic/')) {
                    imageUrls.push(`https://nitter.net${src}`);
                }
            });

            tweets.push({ tweetId, text, imageUrls });
        });

        if (!tweets.length) {
            console.log('⚠️ Твиты не найдены на странице.');
            return;
        }

        tweets.reverse();

        let newTweets;

        if (isFirstRun) {
            newTweets = tweets.slice(-5);
            isFirstRun = false;
        } else {
            const index = tweets.findIndex(t => t.tweetId === lastTweetId);
            newTweets = index === -1 ? tweets : tweets.slice(index + 1);
        }

        if (newTweets.length === 0) {
            console.log('ℹ️ Новых твитов нет.');
            return;
        }

        for (const tweet of newTweets) {
            const messageText = `new post`;

            if (tweet.imageUrls.length === 0) {
                await bot.sendMessage(process.env.OOC_TELEGRAM_CHAT_ID, messageText, { parse_mode: 'HTML' });
            } else if (tweet.imageUrls.length === 1) {
                await bot.sendPhoto(process.env.OOC_TELEGRAM_CHAT_ID, tweet.imageUrls[0], {
                    caption: messageText,
                    parse_mode: 'HTML'
                });
            } else {
                const mediaGroup = tweet.imageUrls.map((url, index) => ({
                    type: 'photo',
                    media: url,
                    ...(index === 0 ? { caption: messageText, parse_mode: 'HTML' } : {})
                }));

                try {
                    await bot.sendMediaGroup(process.env.OOC_TELEGRAM_CHAT_ID, mediaGroup);
                } catch (err) {
                    console.error('❌ Ошибка отправки медиа-группы:', err.message || err);
                    await bot.sendMessage(process.env.OOC_TELEGRAM_CHAT_ID, messageText, { parse_mode: 'HTML' });
                }
            }

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
