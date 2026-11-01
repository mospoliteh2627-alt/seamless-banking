# Как выложить «Вектор Банк» в интернет

Проект — **динамическое приложение**: Node.js/Fastify, WebSocket, QR, опционально Redis.
Поэтому Cloudflare Pages, Netlify и GitHub Pages его **не запустят** — им нужен только
статика. Вариантов три.

---

## Вариант 1. Render (уже используется)

Плюсы: бесплатно, деплой из GitHub, HTTPS, Docker.
Минусы: бесплатный инстанс засыпает через ~15 минут простоя; первый запрос — 30–60 секунд.
Для полевого эксперимента со студентами лучше платный Starter (~$7/мес) или VPS.

### Обновить / пере deploy

1. Запушьте изменения в GitHub:
   ```bash
   git add -A && git commit -m "update" && git push
   ```
2. Render Dashboard → сервис `seamless-banking` → **Manual Deploy → Deploy latest commit**
   (или включите Auto-Deploy).
3. Проверьте `https://<service>.onrender.com/v1/health`.

### Переменные окружения

| Ключ | Значение |
|---|---|
| `JWT_SECRET` | длинная случайная строка (Render → Generate) |
| `REDIS_URL` | пусто — демо-режим в памяти; или internal URL Render Key Value |
| `PORT` | `8787` (задаётся Dockerfile) |

Без Redis приложение работает, но черновики теряются при перезапуске.

### Свой домен

1. Render → Settings → **Custom Domains** → Add `banking.guvanch.ru`.
2. У регистратора: `CNAME banking → <service>.onrender.com`.
3. Подождать 5–30 минут; HTTPS Render выпустит сам.

---

## Вариант 2. Российский VPS (рекомендую для эксперимента)

Timeweb Cloud / Beget, 2 ГБ RAM, ~250–400 ₽/мес. Плюсы: не засыпает, низкая задержка
из РФ, Redis рядом, полный контроль. Минусы: администрирование.

### 1. DNS

У регистратора: `A banking → <IP VPS>` (и `AAAA`, если есть IPv6).

### 2. Сервер

```bash
sudo apt update
sudo apt install -y git docker.io docker-compose-plugin nginx certbot python3-certbot-nginx
git clone https://github.com/mospoliteh2627-alt/seamless-banking.git /opt/seamless-banking
cd /opt/seamless-banking
printf 'JWT_SECRET=%s\n' "$(openssl rand -hex 32)" > .env
docker compose --env-file .env -f deploy/docker-compose.prod.yml up -d --build
curl -fsS http://127.0.0.1:8787/v1/health
```

### 3. Nginx и HTTPS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/seamless-banking
sudo ln -s /etc/nginx/sites-available/seamless-banking /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d banking.guvanch.ru
```

Nginx проксирует на `127.0.0.1:8787`, поддерживает WebSocket и отдаёт APK (64 МБ).

### 4. Обновление

```bash
cd /opt/seamless-banking
git pull
docker compose --env-file .env -f deploy/docker-compose.prod.yml up -d --build
```

### Безопасность

- Redis **не** публикуется наружу (в production-compose порт не открыт).
- Смените демо-код `0000` и админ-код `ADMIN-2026` перед публичным запуском.
- `.env` не коммитится; `JWT_SECRET` — случайный.
- Закройте лишние порты: `ufw allow 22,80,443/tcp && ufw enable`.

---

## Вариант 3. Railway / Fly.io

Оба умеют Docker и Redis, есть бесплатные лимиты/пробный период.
Подходит, если не хочется администрировать VPS, но нужен backend без «засыпания».
Команды — как в Dockerfile; домен привязывается CNAME.

---

## Что важно для этого проекта

- **APK 64 МБ** (`apps/web/VectorBank.apk`) входит в Docker-образ; при проксировании
  поднимите `client_max_body_size` (в nginx.conf уже 100 МБ).
- **WebSocket** нужен для живого перехода; в Nginx включены `Upgrade`/`Connection`.
- **Redis** опционален: без него — in-memory (одна инстанция).
- **Персональные данные**: демо-контур, реальных клиентов нет; для эксперимента
  со студентами — согласие и политика (152-ФЗ).
- **iOS**: IPA без подписи не установить; для iPhone используйте веб-демо или
  сборку через Apple Developer.

---

## Куда привязать домен

- `banking.guvanch.ru` — если основной лендинг на `guvanch.ru`.
- `vector.guvanch.ru` — альтернатива.
- `seamless.guvanch.ru` — если хотите подчеркнуть название проекта.

Домен `itedu.ru` занят; `guvanch.ru`, `itedu.su`, `shamuhammedov.ru` свободны.
