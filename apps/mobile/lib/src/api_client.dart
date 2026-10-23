import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'models.dart';

class ApiException implements Exception {
  const ApiException(this.status, this.code, this.message);

  final int status;
  final String code;
  final String message;

  @override
  String toString() => message;
}

class ApiClient {
  ApiClient({http.Client? client}) : _client = client ?? http.Client();

  static const String baseUrl = String.fromEnvironment(
    'API_BASE',
    defaultValue: 'http://10.0.2.2:8787',
  );

  static const Duration _timeout = Duration(seconds: 12);

  final http.Client _client;
  String? token;

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? headers,
  }) async {
    final uri = Uri.parse('$baseUrl$path');
    final requestHeaders = <String, String>{'Accept': 'application/json', ...?headers};
    if (body != null) requestHeaders['Content-Type'] = 'application/json';
    if (token != null) requestHeaders['Authorization'] = 'Bearer $token';

    http.Response response;
    try {
      switch (method) {
        case 'POST':
          response = await _client.post(uri, headers: requestHeaders, body: jsonEncode(body ?? {})).timeout(_timeout);
          break;
        case 'PATCH':
          response = await _client.patch(uri, headers: requestHeaders, body: jsonEncode(body ?? {})).timeout(_timeout);
          break;
        default:
          response = await _client.get(uri, headers: requestHeaders).timeout(_timeout);
      }
    } on TimeoutException {
      throw const ApiException(0, 'TIMEOUT', 'Сервер не отвечает. Проверьте соединение.');
    } on http.ClientException {
      throw const ApiException(0, 'NETWORK', 'Нет связи с сервером. Проверьте адрес API.');
    } on Exception {
      throw const ApiException(0, 'NETWORK', 'Не удалось выполнить запрос.');
    }

    Map<String, dynamic> data = <String, dynamic>{};
    if (response.body.isNotEmpty) {
      try {
        data = asMap(jsonDecode(response.body));
      } on FormatException {
        data = <String, dynamic>{};
      }
    }

    if (response.statusCode >= 400) {
      final error = asMap(data['error']);
      throw ApiException(
        response.statusCode,
        error['code'] as String? ?? 'HTTP_ERROR',
        error['message'] as String? ?? 'Ошибка ${response.statusCode}',
      );
    }
    return data;
  }

  Future<Map<String, dynamic>> login({
    required String phone,
    required String deviceId,
    required String deviceName,
  }) =>
      _request('POST', '/v1/auth/demo-login', body: {
        'phone': phone,
        'channel': 'mobile',
        'deviceId': deviceId,
        'deviceName': deviceName,
      });

  Future<Map<String, dynamic>> me() => _request('GET', '/v1/me');

  Future<Map<String, dynamic>> stepUp({String method = 'biometric', String proof = 'local-biometric'}) =>
      _request('POST', '/v1/auth/step-up', body: {'method': method, 'proof': proof});

  Future<Map<String, dynamic>> listDrafts() => _request('GET', '/v1/drafts');

  Future<Map<String, dynamic>> listProcesses() => _request('GET', '/v1/processes');

  Future<Map<String, dynamic>> listRecipients() => _request('GET', '/v1/recipients');

  Future<Map<String, dynamic>> createDraft() =>
      _request('POST', '/v1/drafts', body: {'product': 'transfer'});

  Future<Map<String, dynamic>> getDraft(String id) => _request('GET', '/v1/drafts/$id');

  Future<Map<String, dynamic>> patchDraft({
    required String id,
    required int baseVersion,
    required Map<String, dynamic> fields,
    required int step,
    required Map<String, dynamic> context,
  }) =>
      _request('PATCH', '/v1/drafts/$id', body: {
        'baseVersion': baseVersion,
        'fields': fields,
        'step': step,
        'context': context,
      });

  Future<Map<String, dynamic>> preview({String? ticket, String? code}) =>
      _request('POST', '/v1/handoff/preview', body: {
        if (ticket != null) 'ticket': ticket,
        if (code != null) 'code': code,
      });

  Future<Map<String, dynamic>> redeem({
    String? ticket,
    String? code,
    required String deviceId,
    required String deviceName,
  }) =>
      _request('POST', '/v1/handoff/redeem', body: {
        if (ticket != null) 'ticket': ticket,
        if (code != null) 'code': code,
        'deviceId': deviceId,
        'deviceName': deviceName,
      });

  Future<Map<String, dynamic>> submit(String id, {String? idempotencyKey}) => _request(
        'POST',
        '/v1/drafts/$id/submit',
        headers: {if (idempotencyKey != null) 'Idempotency-Key': idempotencyKey},
      );

  Future<void> reportSyncLatency(int milliseconds) async {
    if (milliseconds < 0 || milliseconds > 60000) return;
    try {
      await _request('POST', '/v1/metrics/client', body: {'metric': 'sync', 'ms': milliseconds});
    } on ApiException {
      /* телеметрия не должна влиять на UX */
    }
  }

  void close() => _client.close();
}
