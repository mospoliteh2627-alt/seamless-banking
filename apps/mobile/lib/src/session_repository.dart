import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SessionRepository {
  SessionRepository({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  static const String _tokenKey = 'sb.token';
  static const String _deviceKey = 'sb.deviceId';

  final FlutterSecureStorage _storage;

  Future<String?> readToken() => _storage.read(key: _tokenKey);

  Future<void> saveToken(String token) => _storage.write(key: _tokenKey, value: token);

  Future<void> clearToken() => _storage.delete(key: _tokenKey);

  Future<String> deviceId() async {
    final existing = await _storage.read(key: _deviceKey);
    if (existing != null && existing.isNotEmpty) return existing;
    final created = '${Platform.isIOS ? 'ios' : 'android'}_${DateTime.now().microsecondsSinceEpoch.toRadixString(16)}';
    await _storage.write(key: _deviceKey, value: created);
    return created;
  }

  String get deviceName {
    if (Platform.isIOS) return 'iPhone · iOS';
    if (Platform.isAndroid) return 'Android · смартфон';
    return 'Мобильное устройство';
  }
}
