Map<String, dynamic> asMap(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.cast<String, dynamic>();
  return <String, dynamic>{};
}

class Account {
  const Account({
    required this.id,
    required this.title,
    required this.masked,
    required this.balance,
    required this.currency,
  });

  final String id;
  final String title;
  final String masked;
  final double balance;
  final String currency;

  factory Account.fromJson(Map<String, dynamic> json) => Account(
        id: json['id'] as String? ?? '',
        title: json['title'] as String? ?? '',
        masked: json['masked'] as String? ?? '',
        balance: (json['balance'] as num?)?.toDouble() ?? 0,
        currency: json['currency'] as String? ?? 'RUB',
      );
}

class User {
  const User({
    required this.id,
    required this.name,
    required this.phone,
    required this.segment,
    required this.accounts,
  });

  final String id;
  final String name;
  final String phone;
  final String segment;
  final List<Account> accounts;

  factory User.fromJson(Map<String, dynamic> json) => User(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? '',
        phone: json['phone'] as String? ?? '',
        segment: json['segment'] as String? ?? '',
        accounts: (json['accounts'] as List<dynamic>? ?? [])
            .map((item) => Account.fromJson(asMap(item)))
            .toList(),
      );
}

class SessionInfo {
  const SessionInfo({
    required this.sid,
    required this.deviceId,
    required this.deviceName,
    required this.channel,
    required this.authLevel,
  });

  final String sid;
  final String deviceId;
  final String deviceName;
  final String channel;
  final int authLevel;

  SessionInfo copyWith({int? authLevel}) => SessionInfo(
        sid: sid,
        deviceId: deviceId,
        deviceName: deviceName,
        channel: channel,
        authLevel: authLevel ?? this.authLevel,
      );

  factory SessionInfo.fromJson(Map<String, dynamic> json) => SessionInfo(
        sid: json['sid'] as String? ?? '',
        deviceId: json['deviceId'] as String? ?? '',
        deviceName: json['deviceName'] as String? ?? '',
        channel: json['channel'] as String? ?? 'mobile',
        authLevel: (json['authLevel'] as num?)?.toInt() ?? 1,
      );
}

class DraftContext {
  const DraftContext({this.focus, this.caret = 0, this.scroll = 0});

  final String? focus;
  final int caret;
  final double scroll;

  factory DraftContext.fromJson(Map<String, dynamic> json) => DraftContext(
        focus: json['focus'] as String?,
        caret: (json['caret'] as num?)?.toInt() ?? 0,
        scroll: (json['scroll'] as num?)?.toDouble() ?? 0,
      );
}

class Draft {
  const Draft({
    required this.id,
    required this.status,
    required this.version,
    required this.step,
    required this.totalSteps,
    required this.fields,
    required this.context,
    required this.canEdit,
    required this.updatedAt,
    required this.updatedByDeviceId,
    required this.updatedByDeviceName,
    this.handoff,
  });

  final String id;
  final String status;
  final int version;
  final int step;
  final int totalSteps;
  final Map<String, dynamic> fields;
  final DraftContext context;
  final bool canEdit;
  final String? updatedAt;
  final String? updatedByDeviceId;
  final String? updatedByDeviceName;
  final Map<String, dynamic>? handoff;

  String get recipientName => (fields['recipientName'] ?? '') as String;
  String get recipientBank => (fields['recipientBank'] ?? '') as String;
  String get recipientAccount => (fields['recipientAccount'] ?? '') as String;
  String get amount => (fields['amount'] ?? '') as String;
  String get purpose => (fields['purpose'] ?? '') as String;

  factory Draft.fromJson(Map<String, dynamic> json) {
    final updatedBy = asMap(json['updatedBy']);
    return Draft(
      id: json['id'] as String? ?? '',
      status: json['status'] as String? ?? 'draft',
      version: (json['version'] as num?)?.toInt() ?? 1,
      step: (json['step'] as num?)?.toInt() ?? 1,
      totalSteps: (json['totalSteps'] as num?)?.toInt() ?? 3,
      fields: asMap(json['fields']),
      context: DraftContext.fromJson(asMap(json['context'])),
      canEdit: json['canEdit'] as bool? ?? true,
      updatedAt: json['updatedAt'] as String?,
      updatedByDeviceId: updatedBy['deviceId'] as String?,
      updatedByDeviceName: updatedBy['deviceName'] as String?,
      handoff: json['handoff'] == null ? null : asMap(json['handoff']),
    );
  }
}

class DraftSummary {
  const DraftSummary({
    required this.id,
    required this.status,
    required this.step,
    required this.version,
    required this.recipientName,
    required this.amount,
    required this.updatedAt,
  });

  final String id;
  final String status;
  final int step;
  final int version;
  final String recipientName;
  final String amount;
  final String? updatedAt;

  factory DraftSummary.fromJson(Map<String, dynamic> json) => DraftSummary(
        id: json['id'] as String? ?? '',
        status: json['status'] as String? ?? 'draft',
        step: (json['step'] as num?)?.toInt() ?? 1,
        version: (json['version'] as num?)?.toInt() ?? 1,
        recipientName: json['recipientName'] as String? ?? '',
        amount: json['amount'] as String? ?? '',
        updatedAt: json['updatedAt'] as String?,
      );
}

class Recipient {
  const Recipient({
    required this.id,
    required this.name,
    required this.account,
    required this.bank,
  });

  final String id;
  final String name;
  final String account;
  final String bank;

  String get initials {
    final parts = name.split(RegExp(r'\s+')).where((part) => part.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
  }

  factory Recipient.fromJson(Map<String, dynamic> json) => Recipient(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? '',
        account: json['account'] as String? ?? '',
        bank: json['bank'] as String? ?? '',
      );
}

class ProcessInfo {
  const ProcessInfo({
    required this.id,
    required this.status,
    required this.recipientName,
    required this.amount,
    required this.stage,
    required this.stageLabel,
    required this.riskLabel,
    required this.slaMinutes,
    required this.slaState,
    required this.progress,
  });

  final String id;
  final String status;
  final String recipientName;
  final String amount;
  final int stage;
  final String stageLabel;
  final String riskLabel;
  final int slaMinutes;
  final String slaState;
  final int progress;

  bool get isActive => status == 'draft';

  String get riskText => switch (riskLabel) {
        'high' => 'высокий риск',
        'medium' => 'средний риск',
        _ => 'низкий риск',
      };

  String get slaText {
    if (slaMinutes < 0 || slaState == 'breached') return 'SLA нарушен';
    final hours = slaMinutes ~/ 60;
    final minutes = slaMinutes % 60;
    return 'SLA $hours ч ${minutes.toString().padLeft(2, '0')} мин';
  }

  factory ProcessInfo.fromJson(Map<String, dynamic> json) => ProcessInfo(
        id: json['id'] as String? ?? '',
        status: json['status'] as String? ?? 'draft',
        recipientName: json['recipientName'] as String? ?? '',
        amount: json['amount'] as String? ?? '',
        stage: (json['stage'] as num?)?.toInt() ?? 0,
        stageLabel: json['stageLabel'] as String? ?? '',
        riskLabel: json['riskLabel'] as String? ?? 'low',
        slaMinutes: (json['slaMinutes'] as num?)?.toInt() ?? 0,
        slaState: json['slaState'] as String? ?? 'ok',
        progress: (json['progress'] as num?)?.toInt() ?? 0,
      );
}

class TicketPreview {
  const TicketPreview({
    required this.opId,
    required this.ownerName,
    required this.recipientName,
    required this.recipientBank,
    required this.amount,
    required this.step,
    required this.totalSteps,
  });

  final String opId;
  final String ownerName;
  final String recipientName;
  final String recipientBank;
  final String amount;
  final int step;
  final int totalSteps;

  factory TicketPreview.fromJson(Map<String, dynamic> json) => TicketPreview(
        opId: json['opId'] as String? ?? '',
        ownerName: json['ownerName'] as String? ?? '',
        recipientName: json['recipientName'] as String? ?? 'Новый перевод',
        recipientBank: json['recipientBank'] as String? ?? '',
        amount: json['amount'] as String? ?? '',
        step: (json['step'] as num?)?.toInt() ?? 1,
        totalSteps: (json['totalSteps'] as num?)?.toInt() ?? 3,
      );
}

class Receipt {
  const Receipt({
    required this.id,
    required this.executedAt,
    required this.amount,
    required this.recipientName,
  });

  final String id;
  final String executedAt;
  final double amount;
  final String recipientName;

  factory Receipt.fromJson(Map<String, dynamic> json) => Receipt(
        id: json['id'] as String? ?? '',
        executedAt: json['executedAt'] as String? ?? '',
        amount: (json['amount'] as num?)?.toDouble() ?? 0,
        recipientName: json['recipientName'] as String? ?? '',
      );
}
