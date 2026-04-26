<div align="center">

# 📜 Litopys

**Жива хроніка для вашого ШІ.**

Постійна пам'ять на основі графу, що зберігається між сесіями та клієнтами.
Розроблена для Claude Code, Claude Desktop і будь-якого MCP-сумісного агента.

**[litopys-dev.github.io/litopys](https://litopys-dev.github.io/litopys/)** — встановлення, знімки екрана та швидкий старт

[![CI](https://github.com/litopys-dev/litopys/actions/workflows/ci.yml/badge.svg)](https://github.com/litopys-dev/litopys/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-black)](https://bun.sh)

</div>

> 🇬🇧 [Read in English](./README.md)

---

## Навіщо Litopys?

Сучасні системи пам'яті для ШІ-агентів змушують вибирати: або важкі векторні бази даних із витоками підпроцесів і ~500 МБ оперативної пам'яті, або плоскі markdown-файли, що не масштабуються далі кількох десятків нотаток.

**Litopys обирає третій шлях:** типізований граф знань у звичайних markdown-файлах, доступний через легкий MCP-шар (~75 МБ RAM), придатний для редагування вручну та запитів як за ключовими словами, так і за структурою. Litopys — це «хроніка» українською, і саме такою має бути пам'ять вашого ШІ: жива хроніка того, що він дізнався про вас, коли і чому.

## Можливості

- 🧠 **Типізований граф** — 6 типів вузлів (person, project, system, concept, event, lesson) з 11 відношеннями першого класу
- 🔌 **MCP-native** — працює з Claude Code, Claude Desktop, Cursor, Cline або будь-яким MCP-клієнтом (див. [docs/integrations](docs/integrations/README.uk.md))
- 📝 **Markdown передусім** — кожен вузол є звичайним `.md`-файлом із YAML frontmatter. Редагується вручну, доступний через grep, версіонується в git
- 🤖 **Агностичний екстрактор** — Anthropic, OpenAI або локальний Ollama. Вибирайте відповідно до ресурсів і бюджету (див. [Споживання ресурсів](#споживання-ресурсів) нижче). Факти проходять через quarantine, тому нічого не потрапляє до графу без перевірки
- 🌐 **Вебпанель** — перегляд, пошук, редагування, візуалізація графу та перевірка quarantine за адресою `http://localhost:3999`
- 🔐 **Залишається локальним** — граф зберігається в `~/.litopys/graph/` як файли; сервер за замовчуванням прив'язаний до `127.0.0.1`; без телеметрії

## Панель керування

<p align="center">
  <img src="docs/screenshots/dashboard.png" width="49%" alt="Dashboard — counts by type, live from ~/.litopys/graph">
  <img src="docs/screenshots/graph.png"     width="49%" alt="Graph — typed nodes, directed relations, force-directed layout">
</p>
<p align="center">
  <img src="docs/screenshots/nodes.png"      width="49%" alt="Nodes — searchable table with type filter">
  <img src="docs/screenshots/quarantine.png" width="49%" alt="Quarantine — pending extractor candidates + merge proposals">
</p>

Знімки екрана зроблені на синтетичному демо-графі, що входить до складу `docs/screenshots/` — не особисті нотатки автора.

## Статус

**[v0.1.2](https://github.com/litopys-dev/litopys/releases/tag/v0.1.2) вийшла** — готові двійкові файли для Linux / macOS / Windows (x64 + arm64) із SHA-256 контрольними сумами, що перевіряються `install.sh`. Реліз безпеки на основі стабільної гілки v0.1.1 — див. [CHANGELOG](./CHANGELOG.md). Публічні інтерфейси (MCP tools, CLI, JSON-експорт `schemaVersion: 1`, розташування markdown на диску) заморожені; зворотньо несумісні зміни вийдуть у версії `0.2.x`.

Ядро графу, MCP-сервер (5 інструментів, stdio + HTTP/SSE), екстрактор + quarantine + щотижневий дайджест, daemon з таймером, вебпанель (читання + запис + візуалізація графу + перевірка quarantine), захист від дублювання ідентичностей, збірка в один двійковий файл, однорядковий інсталятор, документація інтеграції для кожного клієнта — все доставлено. Заплановані наступні кроки описані в розділі [Що далі](#що-далі).

## Споживання ресурсів

Реальні числа з власної інсталяції автора (Ubuntu, Bun 1.x). MCP-сервер дешевий; екстрактор — де виникають витрати, і це залежить від обраного адаптера.

| Компонент                        | RAM        | Коли витрачає                             |
|----------------------------------|------------|-------------------------------------------|
| MCP-сервер (stdio або HTTP)      | ~75 МБ     | постійно, поки підключений клієнт         |
| Вебпанель                        | ~50 МБ     | опційно, тільки під час роботи            |
| Екстрактор — Anthropic / OpenAI  | 0 локально | за API-виклик (tokens), без локального RAM|
| Екстрактор — Ollama + модель 3B  | ~2–3 ГБ   | тільки під час тіку, вивантажується після |
| Екстрактор — Ollama + модель 7B  | ~5 ГБ     | тільки під час тіку, вивантажується після |

Мінімальний постійний обсяг — ~75 МБ для MCP-сервера. Екстракція є необов'язковою — можна використовувати Litopys лише для читання/запису з агента і ніколи не запускати daemon. Якщо екстракцію увімкнено, локальний шлях через Ollama обмінює гроші на RAM; шлях через Anthropic/OpenAI обмінює RAM на декілька центів за сесію. Завдяки `keep_alive` Ollama цифри 3B/7B є тимчасовими — модель вивантажується з RAM через кілька хвилин після завершення тіку.

## Швидкий старт

Однорядкова установка (Linux / macOS):

```bash
curl -fsSL https://raw.githubusercontent.com/litopys-dev/litopys/main/install.sh | sh
```

Завантажує єдиний двійковий файл (~100 МБ) до `~/.local/bin/litopys`, ініціалізує `~/.litopys/graph/` з необхідними підкаталогами та виводить підказки для реєстрації MCP.

Щоб закріпити конкретну версію, передайте змінну **після pipe** — змінні середовища, встановлені перед `curl`, діють лише для `curl`, а не для piped-оболонки:

```bash
curl -fsSL https://raw.githubusercontent.com/litopys-dev/litopys/main/install.sh | LITOPYS_VERSION=v0.1.2 sh
```

Потім зареєструйте MCP-сервер у вашому клієнті:

```bash
# Claude Code
claude mcp add litopys -- ~/.local/bin/litopys mcp stdio
```

```json
// Claude Desktop — ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "litopys": {
      "command": "/home/you/.local/bin/litopys",
      "args": ["mcp", "stdio"]
    }
  }
}
```

Перезапустіть клієнт. Ресурс `litopys://startup-context` автоматично завантажує профіль власника, активні проекти, останні події та ключові уроки на початку кожної нової сесії. Агент читає і записує через п'ять MCP-інструментів: `litopys_search`, `litopys_get`, `litopys_related`, `litopys_create`, `litopys_link`.

Повні рецепти для кожного клієнта — у [`docs/integrations/`](./docs/integrations/README.uk.md): Claude Code, Claude Desktop, Cursor, Cline, ChatGPT Connectors, Gemini.

### Режим Remote (HTTP/SSE)

Для віддалених клієнтів (конектори Claude Desktop, браузерні MCP-хости):

```bash
LITOPYS_MCP_TOKEN=your-secret litopys mcp http
# слухає на 127.0.0.1:7777 за замовчуванням
# встановіть LITOPYS_MCP_BIND_ADDR=0.0.0.0 + TLS-проксі для публічного доступу
# встановіть LITOPYS_MCP_CORS_ORIGIN=https://your-client для увімкнення CORS
```

### Встановлення з вихідного коду

```bash
git clone https://github.com/litopys-dev/litopys.git
cd litopys
bun install
bun run build:binary       # створює dist/litopys
```

### Опційно — daemon для тривалих транскриптів

```bash
cp packages/daemon/systemd/litopys-daemon.{service,timer} ~/.config/systemd/user/
systemctl --user enable --now litopys-daemon.timer
```

### Опційно — автозапуск вебпанелі

Вебпанель (`litopys viewer`) можна запустити як systemd user service, щоб вона відновлювалася після кожного перезавантаження. Слухає на `127.0.0.1:3999` за замовчуванням — без публічного доступу, доступна через LAN / WireGuard.

```bash
litopys viewer install          # записує юніт, daemon-reload, enable --now
systemctl --user status litopys-viewer

# Видалити:
litopys viewer uninstall
```

**Автентифікація (тільки для записів).** GET-ендпоінти (перегляд, пошук, відображення графу) відкриті. Мутуючі ендпоінти (створення / редагування / видалення вузла, прийняття або відхилення quarantine) потребують `LITOPYS_VIEWER_TOKEN`:

```bash
# Згенеруйте довільний рядок і додайте його до середовища:
export LITOPYS_VIEWER_TOKEN="$(openssl rand -hex 32)"
litopys viewer
```

Без токена панель працює в режимі лише для читання на loopback і повністю відмовляє в мутуючих запитах при прив'язці до не-loopback-адрес. Вебінтерфейс запитує токен при першій відповіді 401 і зберігає його в `localStorage`. Також можна передати його один раз через `?token=...` — він буде видалений із URL після захоплення.

Або встановіть `LITOPYS_ENABLE_VIEWER=1` при запуску `install.sh`, щоб увімкнути її в межах однорядкового встановлення. Потрібен `loginctl enable-linger $USER`, якщо хочете, щоб панель залишалась активною після виходу з системи.

### Перевірка цілісності

```bash
litopys check           # читабельний звіт, згрупований за типом помилок
litopys check --json    # { nodeCount, edgeCount, errorCount, errors[] } для CI
```

Завантажує та розв'язує весь граф, потім виявляє зламані посилання, дублікати id, відношення з невірними типами та помилки парсингу/валідації. Завершується з ненульовим кодом виходу, якщо виявлені проблеми — додайте до git pre-push hook або кроку CI, щоб відхилення не потрапляло непомітно.

### Резервне копіювання графу

Litopys зберігає все у вигляді звичайних markdown-файлів у `~/.litopys/graph/`, тому підходить будь-який інструмент для версіонування файлів. Два поширені підходи:

**Git + приватний репозиторій** (інкрементальна історія, офсайт, безкоштовно):

```bash
cd ~/.litopys
git init
git add graph/ .gitignore README.md
git commit -m "baseline"
gh repo create my-litopys-graph --private --source=. --push
```

Після цього кожен хук завершення сесії або ручне прийняття залишає ваше робоче дерево зміненим — періодично виконуйте `git add -A && git commit -m "sync" && git push`, щоб резервна копія була актуальною. Ваш граф містить особисті факти, тому тримайте репозиторій **приватним**.

**JSON-знімок** (переносимий, придатний для diff, зручний для інструментів):

```bash
litopys export > graph.json              # компактний
litopys export --pretty > graph.json     # з відступами, зручний для VCS
litopys export --no-body > meta.json     # тільки метадані, без тіл markdown
```

Дамп містить `meta` (exportedAt, counts, schemaVersion) плюс усі вузли, відсортовані за id, та ребра, відсортовані за `(from, relation, to)` — детерміновано між запусками, тому `diff graph-yesterday.json graph-today.json` покаже точно, що LLM/daemon додав. Передавайте до аналітичних інструментів, мігруйте між хостами або комітьте разом із кодом.

Відновлення зі знімку на новому хості (або після перевстановлення):

```bash
litopys import graph.json --dry-run   # попередній перегляд плану
litopys import graph.json             # створити нові вузли, пропустити наявні
litopys import graph.json --force     # також перезаписати наявні id
```

За замовчуванням підхід консервативний — наявні вузли ніколи не змінюються, якщо не передано `--force`. Кожен вузол валідується за схемою заздалегідь, тому пошкоджений знімок скасовується до того, як щось потрапить на диск.

## Історія релізів

Див. [CHANGELOG.md](./CHANGELOG.md). Подальша робота визначається відгуками реальних користувачів — відкривайте issue, якщо щось не подобається.

## Принципи дизайну

- **Агностичний щодо агентів.** Жорстка залежність від будь-якого LLM-постачальника або клієнта відсутня. MCP — єдина точка інтеграції. Ollama є екстрактором за замовчуванням; Anthropic/OpenAI — опційні адаптери.
- **Переносимі дані.** Граф — це звичайний markdown + YAML frontmatter на диску. Читається в будь-якому редакторі, версіонується в git, доступний через grep із командного рядка.
- **Легке виконавче середовище.** ~75 МБ RAM для MCP-сервера. Екстрактор запускається в окремому процесі та працює за вашим розкладом, а не при кожному запиті — дивіться [Споживання ресурсів](#споживання-ресурсів) для повного розбиття витрат по адаптерах.
- **Опційні інтеграції.** Допоміжні засоби для конкретних клієнтів (хуки, фрагменти конфігурації) знаходяться в `docs/integrations/` — Litopys можна використовувати без жодного з них.

## Ліцензія

MIT © 2026 Denis Blashchytsia та учасники Litopys.
