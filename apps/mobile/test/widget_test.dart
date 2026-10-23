import 'package:flutter_test/flutter_test.dart';
import 'package:vector_bank_mobile/src/models.dart';

void main() {
  test('ProcessInfo reads stage, risk and SLA', () {
    final process = ProcessInfo.fromJson({
      'id': 'op_1',
      'status': 'draft',
      'recipientName': 'Иван Петров',
      'amount': '1200.00',
      'stage': 3,
      'stageLabel': 'Переход',
      'riskLabel': 'medium',
      'slaMinutes': 90,
      'slaState': 'at-risk',
      'progress': 55,
    });

    expect(process.isActive, isTrue);
    expect(process.stageLabel, 'Переход');
    expect(process.riskText, 'средний риск');
    expect(process.slaText, 'SLA 1 ч 30 мин');
    expect(process.progress, 55);
  });

  test('ProcessInfo marks breached SLA', () {
    final process = ProcessInfo.fromJson({'slaMinutes': -5, 'slaState': 'breached'});
    expect(process.slaText, 'SLA нарушен');
  });
}
