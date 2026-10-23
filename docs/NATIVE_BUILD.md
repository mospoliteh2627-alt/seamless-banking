# Нативные сборки Android и iOS

Дата: 23.10.2026.

## Артефакты

| Платформа | Файл | Статус |
|---|---|---|
| Android | `dist/VectorBank-android-release.apk` | собран, установлен на эмулятор Pixel_5 |
| iOS | `dist/VectorBank-ios-unsigned.ipa` | собран для arm64 device, **без подписи** |

Android APK: 64 МБ, package `com.vectorbank.vector_bank_mobile`, minSdk 24, targetSdk 36, подписан debug-сертификатом.
iOS: `Runner.app` arm64, bundle `com.vectorbank.vectorBankMobile`, minimum iOS 15.0, `codesign` отсутствует.

## Android: что установлено

- Android SDK 36.1 в `~/Library/Android/sdk`;
- NDK 28.2.13676358;
- CMake 3.22.1;
- Android SDK Platform 34 и 35 (для плагинов);
- JDK из Android Studio JBR;
- Gradle 9.3.1 в workspace `.gradle-home`.

Сборка:

```bash
cd apps/mobile
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export GRADLE_USER_HOME="<workspace>/.gradle-home"
../../../scripts/flutter.sh build apk --release \
  --android-skip-build-dependency-validation
```

Результат: `build/app/outputs/flutter-apk/app-release.apk`.

Проверка:

```bash
adb install -r build/app/outputs/flutter-apk/app-release.apk
adb shell am start -n com.vectorbank.vector_bank_mobile/.MainActivity
```

## iOS: что установлено

- Xcode 26.6;
- Ruby 2.6.10 (системный);
- CocoaPods 1.11.3 в `.gem-home` (Ruby 2.6 не поддерживает 1.12+);
- `ffi 1.15.5`, `i18n 1.8.11`, `zeitwerk 2.6.6`, `drb 2.0.5`, `minitest 5.14.4`;
- `PromisesObjC` зафиксирован на 2.3.1 в `ios/Podfile`;
- Pods установлены, `DT_TOOLCHAIN_DIR` заменён на `TOOLCHAIN_DIR` в сгенерированных xcconfig.

Сборка:

```bash
cd apps/mobile
export GEM_HOME="<workspace>/.gem-home"
export GEM_PATH="$GEM_HOME"
export PATH="$GEM_HOME/bin:$PATH"
export LANG=en_US.UTF-8
cd ios && pod install && cd ..
../../../scripts/flutter.sh build ios --release --no-codesign
```

Результат: `build/ios/iphoneos/Runner.app`.

## Ограничения

### Android
- APK подписан debug-ключом; для публикации нужен release keystore.
- `mobile_scanner` применяет Kotlin Gradle Plugin; Flutter предупреждает о будущей несовместимости.
- APK содержит debug-подпись, но собран в release-режиме.

### iOS
- Приложение **не подписано**: установка на устройство невозможна без Apple Developer certificate/provisioning profile.
- CocoaPods 1.11.3 — обход ограничения Ruby 2.6; для промышленной сборки нужен Ruby 3 + CocoaPods 1.16.
- GoogleMLKit/MLKit не поддерживают arm64-симулятор iOS 26; сборка для device arm64 работает, симулятор — нет.
- `NSAllowsArbitraryLoads` включён для демо-API; в продакшене только HTTPS.

## Что проверено

- Android APK установлен и запущен на Pixel_5 (API 36).
- Открыт главный экран с процессами, получателями и нативным нижним меню.
- Открыт перевод, поля предзаполнены, чекбокс сохранения получателя работает.
- iOS собран Xcode без ошибок, но не подписан.

Скриншоты: `docs/screens/16-native-android.png`, `docs/screens/17-native-android-draft.png`.
