# Инструменты для Apify Store

В этой папке лежат инструменты (в Apify они называются Actors), которые публикуются в [Apify Store](https://apify.com/store). Покупатели платят за результат, Apify хостит код и переводит автору 80% выручки за вычетом стоимости запуска.

| Папка | Что делает | Состояние |
| --- | --- | --- |
| `telegram-channel-scraper` | Выгружает посты публичных Telegram-каналов, фильтрует их по ключевым словам и следит за новыми | Код готов, 65 автотестов, проверен на 1440 реальных постах. Не опубликован |

## Как опубликовать инструмент

Названия кнопок в консоли Apify могут немного отличаться: шаги составлены по документации, а не по самой консоли.

1. Зарегистрируйся на <https://console.apify.com>.
2. Создай Actor из репозитория: **Actors → Development → Create new**, тип источника **Git repository**, подключи GitHub и вставь адрес:

   ```
   https://github.com/MatKotik/PErnektum#claude/fable-vs-opus-comparison-be9ry6:actors/telegram-channel-scraper
   ```

   После слияния ветки в `main` замени адрес на `https://github.com/MatKotik/PErnektum#main:actors/telegram-channel-scraper`.
3. Нажми **Build**, дождись сборки и запусти **Start** с вводом по умолчанию. В результате должно быть 20 постов канала `telegram`.
4. Открой вкладку **Settings** и поменяй:
   - имя инструмента: `telegram-channel-scraper` (оно попадает в адрес страницы в магазине);
   - заголовок: `Telegram Channel Scraper & Monitor`;
   - лимит времени по умолчанию: 3600 секунд (при 300 секундах большие выгрузки обрываются).

   Память оставь 1 GB. На выгрузке 10 000 постов инструмент занимал до 250 MB, а стоимость памяти рядом с ценой результата незаметна.
5. Открой вкладку **Publishing** и заполни:
   - **Display information.** Иконка: `telegram-channel-scraper/assets/icon.png`. Категории: Social media и News. Название и описание подставятся из кода.
   - **SEO title:** `Telegram Channel Scraper & Monitor – Export Posts, No Login`
   - **SEO description:** `Scrape public Telegram channels: posts, views, reactions, media and polls. Monitor channels for new posts. No API key. $0.50 per 1,000 posts.`
   - **Monetization.** Модель **Pay per event**, два события:

     | Событие | FREE | BRONZE | SILVER | GOLD |
     | --- | --- | --- | --- | --- |
     | `apify-default-dataset-item` (основное) | $0.0005 | $0.00045 | $0.0004 | $0.00035 |
     | `apify-actor-start` | $0.003 | $0.003 | $0.003 | $0.003 |

     Минимальный лимит расходов на запуск: $0.01.
   - **Actor permissions:** Limited.
6. В **Settings → Payouts** пройди проверку личности и укажи способ вывода (PayPal или Wise от $20, банк от $100).
7. Нажми **Publish on Store**.

Цены в таблице совпадают с теми, что написаны в описании инструмента. Если меняешь цену, поправь раздел «How much does it cost» в `telegram-channel-scraper/README.md`.

## Что делать после публикации

- Apify каждый день запускает инструмент с вводом по умолчанию. Если проверка падает, придёт письмо, а инструмент получит пометку «Under maintenance». Тогда открой сессию с Claude и перешли текст письма.
- Вопросы пользователей приходят во вкладку **Issues** инструмента. Их тоже можно переслать Claude.
- Доходы видны в **Insights → Actor analytics**, выплаты формируются раз в месяц.

## Проверка на своём компьютере

Нужен Node.js 22 или новее.

```bash
cd actors/telegram-channel-scraper
npm install
npm test
```

Запуск без Apify:

```bash
mkdir -p storage/key_value_stores/default
echo '{"channels":["telegram"],"maxPostsPerChannel":20}' > storage/key_value_stores/default/INPUT.json
npm start
```

Посты появятся в `storage/datasets/default`.
