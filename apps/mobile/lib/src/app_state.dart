import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'api_client.dart';
import 'models.dart';
import 'session_repository.dart';

class AppState extends ChangeNotifier {
  AppState({required this.api, required this.repo});

  final ApiClient api;
  final SessionRepository repo;

  bool ready = false;
  bool busy = false;
  String? lastError;
  User? user;
  SessionInfo? session;
  Draft? draft;
  String? restoredLabel;
  Receipt? receipt;
  String? _submitKey;
  List<DraftSummary> drafts = const [];
  List<ProcessInfo> processes = const [];
  List<Recipient> recipients = const [];

  WebSocketChannel? _socket;
  StreamSubscription<dynamic>? _subscription;

  bool get isAuthenticated => session != null;

  Future<void> bootstrap() async {
    final token = await repo.readToken();
    if (token != null && token.isNotEmpty) {
      api.token = token;
      try {
        final me = await api.me();
        _applyAuth(me);
        _connect();
        await loadDrafts();
      } on ApiException {
        api.token = null;
        await repo.clearToken();
      }
    }
    ready = true;
    notifyListeners();
  }

  void _applyAuth(Map<String, dynamic> payload) {
    user = User.fromJson(asMap(payload['user']));
    session = SessionInfo.fromJson(asMap(payload['session']));
  }

  Future<void> login(String phone) async {
    busy = true;
    lastError = null;
    notifyListeners();
    try {
      final deviceId = await repo.deviceId();
      final response = await api.login(
        phone: phone,
        deviceId: deviceId,
        deviceName: repo.deviceName,
      );
      api.token = response['token'] as String?;
      if (api.token != null) await repo.saveToken(api.token!);
      _applyAuth(response);
      await loadDrafts();
      _connect();
    } on ApiException catch (error) {
      lastError = error.message;
      rethrow;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    await repo.clearToken();
    api.token = null;
    await _subscription?.cancel();
    _subscription = null;
    await _socket?.sink.close();
    _socket = null;
    user = null;
    session = null;
    draft = null;
    drafts = const [];
    processes = const [];
    recipients = const [];
    restoredLabel = null;
    receipt = null;
    notifyListeners();
  }

  Future<void> loadDrafts() async {
    final response = await api.listDrafts();
    drafts = (response['items'] as List<dynamic>? ?? [])
        .map((item) => DraftSummary.fromJson(asMap(item)))
        .where((item) => item.status == 'draft')
        .toList();
    notifyListeners();
  }

  Future<void> loadRecipients() async {
    final response = await api.listRecipients();
    recipients = (response['items'] as List<dynamic>? ?? [])
        .map((item) => Recipient.fromJson(asMap(item)))
        .toList();
    notifyListeners();
  }

  Future<void> loadProcesses() async {
    final response = await api.listProcesses();
    processes = (response['items'] as List<dynamic>? ?? [])
        .map((item) => ProcessInfo.fromJson(asMap(item)))
        .toList();
    notifyListeners();
  }

  Future<Draft> createDraft() async {
    final response = await api.createDraft();
    draft = Draft.fromJson(asMap(response['draft']));
    restoredLabel = null;
    notifyListeners();
    return draft!;
  }

  Future<Draft> createDraftForRecipient(Recipient recipient) async {
    if (session?.authLevel != 2) await stepUp();
    await createDraft();
    await saveDraft(
      fields: {
        'recipientName': recipient.name,
        'recipientBank': recipient.bank,
        'recipientAccount': recipient.account,
        'currency': 'RUB',
        'saveRecipient': false,
      },
      step: 1,
      focus: 'amount',
    );
    return draft!;
  }

  Future<Draft> openDraft(String id) async {
    final response = await api.getDraft(id);
    draft = Draft.fromJson(asMap(response['draft']));
    restoredLabel = null;
    notifyListeners();
    return draft!;
  }

  Future<TicketPreview> preview({String? ticket, String? code}) async {
    final response = await api.preview(ticket: ticket, code: code);
    return TicketPreview.fromJson(asMap(response['preview']));
  }

  Future<void> stepUp({String proof = 'local-biometric'}) async {
    final response = await api.stepUp(proof: proof);
    final token = response['token'] as String?;
    if (token != null) {
      api.token = token;
      await repo.saveToken(token);
    }
    session = session?.copyWith(authLevel: 2);
    notifyListeners();
  }

  Future<void> redeem({String? ticket, String? code}) async {
    final deviceId = await repo.deviceId();
    final response = await api.redeem(
      ticket: ticket,
      code: code,
      deviceId: deviceId,
      deviceName: repo.deviceName,
    );
    draft = Draft.fromJson(asMap(response['draft']));
    final restored = asMap(response['restored']);
    final focus = restored['focus'] as String?;
    final step = (restored['step'] as num?)?.toInt() ?? draft!.step;
    restoredLabel = [
      'Шаг $step',
      if (focus != null) 'фокус на «${fieldTitle(focus)}»',
      'версия ${restored['version'] ?? draft!.version}',
    ].join(' · ');
    notifyListeners();
  }

  Future<bool> saveDraft({
    required Map<String, dynamic> fields,
    int? step,
    String? focus,
    int caret = 0,
    double scroll = 0,
  }) async {
    final current = draft;
    if (current == null) return false;
    try {
      final response = await api.patchDraft(
        id: current.id,
        baseVersion: current.version,
        fields: fields,
        step: step ?? current.step,
        context: {
          if (focus != null) 'focus': focus,
          'caret': caret,
          'scroll': scroll,
          'locale': 'ru-RU',
        },
      );
      draft = Draft.fromJson(asMap(response['draft']));
      lastError = null;
      notifyListeners();
      return true;
    } on ApiException catch (error) {
      lastError = error.message;
      if (error.code == 'LEASE_HELD' || error.code == 'VERSION_CONFLICT') {
        try {
          final response = await api.getDraft(current.id);
          draft = Draft.fromJson(asMap(response['draft']));
        } on ApiException {
          /* оставляем локальное состояние */
        }
      }
      notifyListeners();
      return false;
    }
  }

  Future<Receipt> submit() async {
    final current = draft;
    if (current == null) throw const ApiException(0, 'NO_DRAFT', 'Черновик не найден');
    _submitKey ??= '${current.id}-${DateTime.now().microsecondsSinceEpoch}';
    final response = await api.submit(current.id, idempotencyKey: _submitKey);
    _submitKey = null;
    draft = Draft.fromJson(asMap(response['draft']));
    final value = Receipt.fromJson(asMap(response['receipt']));
    receipt = value;
    notifyListeners();
    return value;
  }

  void _connect() {
    final token = api.token;
    if (token == null || token.isEmpty) return;
    _subscription?.cancel();
    _socket?.sink.close();

    final base = ApiClient.baseUrl.replaceFirst('http', 'ws');
    final uri = Uri.parse('$base/v1/stream?token=${Uri.encodeComponent(token)}');
    final socket = WebSocketChannel.connect(uri);
    _socket = socket;
    _subscription = socket.stream.listen(
      (event) {
        if (event is! String) return;
        final message = asMap(jsonDecode(event));
        final payload = asMap(message['payload']);
        if (message['type'] == 'draft.updated') {
          final incoming = Draft.fromJson(asMap(payload['draft']));
          if (draft?.id == incoming.id && incoming.updatedByDeviceId != session?.deviceId) {
            final updatedAt = DateTime.tryParse(incoming.updatedAt ?? '');
            if (updatedAt != null) {
              final latency = DateTime.now().difference(updatedAt).inMilliseconds;
              api.reportSyncLatency(latency);
            }
            draft = incoming;
            notifyListeners();
          }
        }
        if (message['type'] == 'draft.submitted') {
          final incoming = Draft.fromJson(asMap(payload['draft']));
          if (draft?.id == incoming.id) {
            draft = incoming;
            receipt = Receipt.fromJson(asMap(payload['receipt']));
            notifyListeners();
          }
        }
      },
      onError: (_) {},
      onDone: () {},
    );
  }

  static String fieldTitle(String name) {
    const titles = {
      'recipientName': 'Получатель',
      'recipientBank': 'Банк',
      'recipientAccount': 'Счёт',
      'amount': 'Сумма',
      'purpose': 'Назначение',
    };
    return titles[name] ?? name;
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _socket?.sink.close();
    super.dispose();
  }
}
