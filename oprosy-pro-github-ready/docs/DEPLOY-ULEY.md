# Развёртывание в УЛЬЕ

## Требования к ZIP

В корне архива должны находиться:

```text
server.js
package.json
public/
data/.gitkeep
```

Не включайте в архив:

- `node_modules`;
- рабочий `data/db.json`;
- `.master-key`;
- `OWNER_FIRST_LOGIN.txt`;
- локальные резервные копии.

## Запуск

УЛЕЙ передаёт приложению назначенный порт через `process.env.PORT`.

Команда запуска:

```bash
npm start
```

или:

```bash
node server.js
```

## Health-check

```text
GET /api/health
```

Ожидаемый ответ:

```json
{"ok":true,"service":"oprosy-pro","port":3200}
```

## Постоянные данные

При безопасном редеплое код меняется, а папка данных должна сохраняться. Для явного пути задайте:

```text
OPROSY_DATA_DIR=/opt/uley/projects/<project>/data
```

## Первая активация

Укажите одноразовый код в переменной:

```text
OPROSY_OWNER_ACTIVATION_CODE
```

После активации OWNER код следует удалить из переменных окружения или заменить.
