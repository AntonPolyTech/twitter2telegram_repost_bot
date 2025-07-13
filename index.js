import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import translate from '@iamtraction/google-translate';
import fs from 'fs';
import delay from 'delay';

dotenv.config();

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: false });
const NITTER_INSTANCES = [
    'https://nitter.poast.org',
    'https://nitter.privacydev.net',
    'https://nitter.net',
    'https://nitter.kavin.rocks',
    'https://nitter.moomoo.me',
    'https://nitter.projectsegfau.lt',
    'https://nitter.cz',
];

const USERNAME = 'BarcaUniversal';
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

async function fetchTweetsFromNitter(baseUrl) {
    const url = `${baseUrl}/${USERNAME}`;
    console.log(`🌐 Пытаюсь загрузить с ${url}`);

    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (res.status === 429) {
        throw new Error('Rate limit от Nitter (429)');
    }
    if (!res.ok) {
        throw new Error(`HTTP ошибка ${res.status}`);
    }

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

        const images = [];
        $(el).find('.attachments .still-image img').each((_, img) => {
            let imgUrl = $(img).attr('src');
            if (imgUrl && imgUrl.startsWith('/')) {
                imgUrl = baseUrl + imgUrl;
            }
            images.push(imgUrl);
        });

        tweets.push({ tweetId, text, images });
    });

    return tweets;
}

async function checkTweets() {
    let success = false;

    for (const instance of NITTER_INSTANCES) {
        try {
            const tweets = await fetchTweetsFromNitter(instance);
            if (!tweets.length) {
                console.warn(`⚠️ Нет твитов на ${instance}`);
                continue;
            }

            console.log(`✅ Загружено ${tweets.length} твитов`);
            tweets.reverse();

            let newTweets;
            if (isFirstRun) {
                newTweets = tweets.slice(-3);
                isFirstRun = false;
            } else {
                const index = tweets.findIndex(t => t.tweetId === lastTweetId);
                newTweets = index === -1 ? tweets : tweets.slice(index + 1);
            }

            if (!newTweets.length) {
                console.log('ℹ️ Новых твитов нет.');
                return;
            }

            for (const tweet of newTweets) {
                console.log('📌 Обработка твита:', tweet.tweetId);

                let translatedText = '';
                try {
                    const res = await translate(tweet.text, { to: 'ru' });
                    translatedText = res.text;
                } catch (err) {
                    console.error('❌ Ошибка перевода:', err.message || err);
                    translatedText = '⚠️ Ошибка перевода.';
                }

                const caption = `🐦 <b>Новый твит от BarcaUniversal</b>\n\n${tweet.text}\n\n🌐 <b>Перевод:</b>\n${translatedText}`;

                if (tweet.images.length > 0) {
                    const mediaGroup = tweet.images.slice(0, 10).map((imgUrl, i) => ({
                        type: 'photo',
                        media: imgUrl,
                        ...(i === 0 ? { caption, parse_mode: 'HTML' } : {}),
                    }));
                    await bot.sendMediaGroup(process.env.TELEGRAM_CHAT_ID, mediaGroup);
                } else {
                    await bot.sendMessage(process.env.TELEGRAM_CHAT_ID, caption, { parse_mode: 'HTML' });
                }

                lastTweetId = tweet.tweetId;
                saveLastTweetId(lastTweetId);
                console.log('✅ Отправлен твит:', tweet.tweetId);
                await delay(1000); // задержка между отправками
            }

            success = true;
            break;
        } catch (err) {
            console.warn(`⚠️ Ошибка при попытке с ${instance}:`, err.message);
            await delay(2000); // пауза между зеркалами
        }
    }

    if (!success) {
        console.error('❌ Все Nitter-зеркала недоступны. Уведомление отправлено.');
        await bot.sendMessage(
            process.env.TELEGRAM_CHAT_ID,
            '⚠️ Все Nitter-зеркала сейчас недоступны. Попробуем позже.'
        );
    }
}

console.log('🔔 Бот запущен и слушает Nitter...');
checkTweets();
setInterval(checkTweets, INTERVAL_MINUTES * 60 * 1000);
