import fs from 'fs';
import dotenv from 'dotenv';
import { TwitterApi } from 'twitter-api-v2';
import TelegramBot from 'node-telegram-bot-api';
import translate from '@iamtraction/google-translate';

dotenv.config();

const twitter = new TwitterApi(process.env.TWITTER_BEARER_TOKEN);
const roClient = twitter.readOnly;

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const TWITTER_USER_ID = process.env.TWITTER_USERID;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const LAST_ID_FILE = 'last_id.txt';

// Загрузка lastSentId из файла
function loadLastId() {
    try {
        return fs.readFileSync(LAST_ID_FILE, 'utf8');
    } catch (e) {
        return null;
    }
}

// Сохранение lastSentId в файл
function saveLastId(id) {
    try {
        fs.writeFileSync(LAST_ID_FILE, id, 'utf8');
    } catch (e) {
        console.error('⚠️ Не удалось сохранить lastSentId:', e);
    }
}

let lastSentId = loadLastId();

async function fetchTweets() {
    const timeline = await roClient.v2.userTimeline(TWITTER_USER_ID, {
        max_results: 5,
        'tweet.fields': ['created_at', 'text', 'attachments'],
        expansions: ['attachments.media_keys'],
        'media.fields': ['url', 'preview_image_url', 'type'],
        exclude: 'replies',
    });

    return {
        tweets: timeline?.data?.data || [],
        media: timeline?.data?.includes?.media || [],
    };
}

function getTweetMedia(tweet, allMedia) {
    const keys = tweet.attachments?.media_keys;
    if (!keys) return [];

    return allMedia.filter(m => keys.includes(m.media_key) && m.type === 'photo');
}

async function checkAndSend() {
    try {
        const { tweets, media } = await fetchTweets();

        if (!Array.isArray(tweets)) {
            console.error('❌ Tweets is not an array:', tweets);
            return;
        }

        for (const tweet of tweets.reverse()) {
            if (tweet.id === lastSentId) continue;

            const images = getTweetMedia(tweet, media);
            let translationText = '';

            try {
                const res = await translate(tweet.text, { to: 'ru' });
                translationText = res.text;
            } catch (transErr) {
                console.error('❌ Ошибка перевода:', transErr);
                translationText = '⚠️ Ошибка перевода.';
            }

            const caption = `🐦 <b>Твит:</b>\n🕓 ${tweet.created_at}\n\n${tweet.text}\n\n🌐 <b>Перевод:</b>\n${translationText}`;

            if (images.length > 0) {
                const mediaGroup = images.slice(0, 10).map((img, index) => ({
                    type: 'photo',
                    media: img.url,
                    ...(index === 0 ? { caption, parse_mode: 'HTML' } : {}),
                }));

                await bot.sendMediaGroup(TG_CHAT_ID, mediaGroup);
            } else {
                await bot.sendMessage(TG_CHAT_ID, caption, { parse_mode: 'HTML' });
            }

            lastSentId = tweet.id;
            saveLastId(tweet.id); // сохраняем
        }
    } catch (err) {
        if (err.code === 429) {
            const resetTime = err.rateLimit?.reset
                ? new Date(err.rateLimit.reset * 1000).toLocaleTimeString()
                : 'позже';
            console.warn(`⏳ Rate limit exceeded. Try again after ${resetTime}`);
        } else {
            console.error('❌ Ошибка при получении твитов:', err);
        }
    }
}

bot.sendMessage(TG_CHAT_ID, '🔔 Бот запущен!');
setInterval(checkAndSend, 5 * 60 * 1000);
checkAndSend();
