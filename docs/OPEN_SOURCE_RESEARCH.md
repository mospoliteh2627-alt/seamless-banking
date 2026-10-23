# Что взято из открытых систем

Дата: 23.10.2026.

## Источники

- **Mifos X / Mifos Mobile** — открытая self-service банковская платформа: клиенты, счета, переводы, бенефициары, REST API.  
  https://mifosforge.jira.com/wiki/spaces/MP/pages/4713807893/Mifos+Mobile+REST+API+Documentation
- **Apache Fineract** — открытое банковское ядро; Customer Self-Service как отдельный канал.  
  https://cwiki.apache.org/confluence/display/FINERACT/Customer+Self-Service
- **Open Banking UK** — Customer Experience Guidelines, redirection и QR-код при аутентификации.  
  https://standards.openbanking.org.uk/customer-experience-guidelines/authentication-methods/redirection-tpp-generated-qrcode/v3-1-0/
- **OpenID Foundation FAPI 2.0** — профиль безопасности API.  
  https://openid.net/specs/fapi-2_0-security-profile.html

## Что взято в прототип

| Практика | Источник | Реализация |
|---|---|---|
| Saved beneficiaries | Mifos, Fineract | `GET/POST/DELETE /v1/recipients`, чипы на веб и мобильном |
| Self-service перевод | Mifos Mobile | мобильный «Новый перевод» без звонка в банк |
| QR/redirection handoff | Open Banking UK | QR + одноразовый билет + код |
| Step-up | FAPI 2.0 / PSD2 | обязательный шаг перед redeem |
| Процесс и SLA | Fineract self-service | стадии, прогресс, риск, SLA на веб и мобильном |

## Что не копировалось

- Код Mifos/Fineract не переносился: использованы только идеи продуктовых сценариев и API-подход.
- Платёжное ядро, KYC, бухгалтерия и реальные бенефициары не реализованы.
- QR-профиль Open Banking UK не сертифицирован; прототип показывает flow, а не соответствие стандарту.

## Вывод

Самые практичные функции для диссертации — не «ещё один экран», а **повторяемые получатели** и **двусторонний переход**: они сокращают повторный ввод и проверяются в E2E. Поэтому добавлены recipients, mobile → web и процессная карта.
