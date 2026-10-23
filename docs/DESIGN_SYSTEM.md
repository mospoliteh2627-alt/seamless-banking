# Дизайн-система «Вектор Банк»

Документ фиксирует токены, компоненты и правила кроссплатформенной консистентности,
использованные в web- и mobile-клиентах прототипа. Служит источником для раздела 2.3
диссертации.

## 1. Токены

### Цвет

| Токен | Web (CSS) | Flutter | Назначение |
|---|---|---|---|
| `ink` | `#0B1F3A` | `AppColors.ink` | основной текст, шапка |
| `inkSoft` | `#22324A` | `AppColors.inkSoft` | вторичный текст |
| `muted` | `#56657A` | `AppColors.muted` | подписи, подсказки |
| `line` | `#E4E9F1` | `AppColors.line` | границы, разделители |
| `background` | `#F2F5FA` | `AppColors.background` | фон приложения |
| `surface` | `#FFFFFF` | `AppColors.surface` | карточки, поля |
| `accent` | `#1F57E0` | `AppColors.accent` | действия, фокус |
| `accentDark` | `#1746C2` | `AppColors.accentDark` | hover/active |
| `mint` | `#16C2A3` | `AppColors.mint` | успех, синхронизация |
| `danger` | `#D64545` | `AppColors.danger` | ошибки |

Контраст: `muted` и `accent` подобраны под WCAG 2.2 AA (≥ 4,5:1 для обычного текста).

### Типографика

| Роль | Размер / вес | Web | Flutter |
|---|---|---|---|
| Display | 30–38 / 700 | `.hello h1`, `.account-balance` | `headlineMedium` |
| H1 | 26–28 / 700 | `.transfer-head h1` | `titleLarge` |
| H2 | 22–24 / 700 | `.modal-card h2` | `titleMedium` |
| Body | 14–15 / 400 | `body` | `bodyMedium` |
| Caption | 12–13 / 400–600 | `.muted`, `.small` | `bodySmall` |
| Overline | 11–11.5 / 700, +0.12em | `.eyebrow` | `labelSmall` |

Шрифт: системный стек Inter / SF Pro / Segoe UI / Roboto. В DOCX — Times New Roman 12 пт
по требованиям вуза; дизайн-система интерфейса на это не влияет.

### Пространство и форма

| Токен | Значение |
|---|---|
| spacing | 4 / 8 / 12 / 16 / 18 / 22 / 26 / 34 |
| radius | 10 / 14 / 20 / 22 / 26 / 999 |
| shadow | `0 24px 60px -32px rgba(11,31,58,.45)` |
| border | 1 px `line` |
| focus ring | 3 px `rgba(31,87,224,.35)`, offset 2 |

### Движение

- длительность 120–220 мс, easing `ease`;
- при `prefers-reduced-motion` и классе `a11y-reduce-motion` анимации отключаются;
- в Flutter — `MediaQuery.disableAnimations` / `AnimationStyle` (проверить в сборке).

## 2. Компоненты

| Компонент | Web | Flutter | Состояния |
|---|---|---|---|
| Кнопка | `.btn` + модификаторы | `FilledButton` / `OutlinedButton` | default, hover, focus, disabled, loading |
| Поле | `.field input` | `TextField` + `InputDecoration` | default, focus, error, readonly |
| Переключатель | `.toggle` | `Switch` | off, on, focus |
| Шаги | `.steps` | `List.generate` + полосы | active, done, disabled |
| Карточка | `.card` | `Container` + border | default, accent, success |
| Бейдж | `.badge` | `Container` | neutral, soft, live |
| Модальное окно | `.modal` | `showDialog` | open, closing |
| Тост | `.toast` | `SnackBar` | info, error |
| Индикатор синхронизации | `.save-indicator` | `Row` + dot | saving, saved, error |

## 3. Семантика состояний

Единые имена и поведение:

- `idle` — данные не менялись;
- `saving` — идёт PATCH, точка жёлтая, текст «Сохраняем…»;
- `saved` — версия подтверждена, точка зелёная, время сохранения;
- `error` — сеть/409, точка красная, текст ошибки;
- `readonly` — lease у другого устройства, поля `readOnly`, кнопки `disabled`,
  баннер «Операция продолжена на …», доступна кнопка «Вернуть управление»;
- `submitted` — успех, показывается чек, форма недоступна.

Правила:

1. Ошибка валидации — у поля, а не только тостом.
2. Конфликт версии — показывается актуальный черновик, а не «попробуйте ещё раз».
3. Потеря WebSocket — бейдж `offline`, автопереподключение, данные не теряются.
4. Все переходы сопровождаются `aria-live`-сообщением.

## 4. Кроссплатформенное соответствие

| Смысл | Web | Flutter |
|---|---|---|
| Основное действие | `.btn-primary` | `FilledButton` |
| Второстепенное | `.btn-secondary` | `OutlinedButton` |
| Опасное | `.btn-danger` (резерв) | `FilledButton(style: error)` |
| Фокус | `:focus-visible` ring | `FocusNode` + `focusColor` |
| Ошибка | `.field.is-invalid` | `InputDecoration.errorText` |
| Загрузка | spinner + `disabled` | `CircularProgressIndicator` + `onPressed: null` |

## 5. Доступность

- контраст ≥ 4,5:1, крупный текст ≥ 3:1;
- цель ≥ 24×24 px (WCAG 2.2 SC 2.5.8);
- видимый фокус, логичный порядок табуляции, focus trap в модальных окнах;
- альтернатива QR — шестизначный код;
- перенос профиля доступности (масштаб, контраст, reduce motion) в составе контекста;
- `aria-live` для статуса сохранения и перехода;
- `prefers-reduced-motion`.

## 6. Версионирование

- токены — SemVer (`design-tokens@1.0.0`);
- компонент считается изменённым, если меняется токен или контракт состояния;
- визуальная регрессия — скриншоты Playwright по 7 экранам;
- аудит доступности — axe-core в CI (0 serious/critical).
