# Вектор Банк — мобильный клиент (Flutter)

Клиент реализует ключевой сценарий бесшовного перехода:

1. вход по номеру телефона (демо-код `0000`);
2. сканирование QR-кода, показанного в интернет-банке, либо ручной ввод шестизначного кода;
3. предпросмотр операции (получатель, сумма, шаг);
4. подтверждение личности через Face ID / Touch ID (fallback — PIN `0000`);
5. `POST /v1/auth/step-up` — повышение уровня аутентификации;
6. `POST /v1/handoff/redeem` — одноразовый билет обменивается на доступ к черновику;
7. восстановление полей, шага и позиции курсора; автосохранение и отправка перевода.

## Запуск

```bash
# из каталога apps/mobile
flutter create .          # создаст android/ ios/ (один раз)
flutter pub get
```

Адрес API задаётся через `--dart-define`:

```bash
# Android-эмулятор: 10.0.2.2 — это localhost хост-машины
flutter run --dart-define=API_BASE=http://10.0.2.2:8787

# iOS-симулятор
flutter run --dart-define=API_BASE=http://127.0.0.1:8787
```

По умолчанию в `lib/src/api_client.dart` уже стоит `http://10.0.2.2:8787`.

В `android/app/build.gradle` установите `minSdkVersion 23` и `compileSdk 34`
(требования `local_auth` и `mobile_scanner`); для iOS — deployment target 12.0.

## Разрешения

`android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.USE_BIOMETRIC" />
<uses-permission android:name="android.permission.USE_FINGERPRINT" />
```

Для демо-контура по HTTP в теге `<application>`:

```xml
android:usesCleartextTraffic="true"
```

`ios/Runner/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Камера нужна для сканирования QR-кода перехода</string>
<key>NSFaceIDUsageDescription</key>
<string>Face ID подтверждает переход к операции с компьютера</string>
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsArbitraryLoads</key>
  <true/>
</dict>
```

## Структура

```
lib/
├── main.dart                 # точка входа, AppScope, RootGate
└── src/
    ├── api_client.dart       # REST-клиент, ApiException
    ├── app_scope.dart        # InheritedNotifier<AppState>
    ├── app_state.dart        # состояние, WebSocket, бизнес-операции
    ├── models.dart           # User, Draft, TicketPreview, Receipt
    ├── session_repository.dart # secure storage, deviceId
    ├── theme.dart            # дизайн-токены Material 3
    └── screens/
        ├── login_screen.dart
        ├── home_screen.dart
        ├── scan_screen.dart
        ├── confirm_screen.dart
        └── draft_screen.dart
```

## Ограничения демо

- Биометрия и камера на эмуляторе могут быть недоступны — предусмотрен PIN-fallback.
- Платёжное ядро и реальные ПДн не подключены; используется демо-пользователь `user_42`.
- В промышленном контуре `API_BASE` — только HTTPS, а `usesCleartextTraffic` отключается.
