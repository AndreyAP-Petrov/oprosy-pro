# Развёртывание на VPS

## Рекомендуемый контур

- Ubuntu 24.04 LTS;
- Node.js 20/22 LTS;
- PM2;
- Nginx;
- HTTPS через Certbot;
- отдельный каталог данных вне каталога приложения.

## Каталоги

```bash
mkdir -p /var/www/oprosy-pro
mkdir -p /var/lib/oprosy-pro
chmod 700 /var/lib/oprosy-pro
```

## Запуск через PM2

```bash
cd /var/www/oprosy-pro
OPROSY_DATA_DIR=/var/lib/oprosy-pro PORT=3000 pm2 start server.js --name oprosy-pro
pm2 save
```

Секретные переменные лучше задавать через ecosystem-файл вне репозитория либо через системный менеджер секретов.

## Nginx

```nginx
server {
    listen 80;
    server_name example.ru;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

После настройки DNS включите HTTPS и закройте прямой внешний доступ к порту Node.js.

## Резервное копирование

В резервную копию входят:

```text
/var/lib/oprosy-pro/db.json
/var/lib/oprosy-pro/.master-key
```

Хранить эти два файла нужно вместе. Без `.master-key` существующие TOTP-секреты невозможно расшифровать.
