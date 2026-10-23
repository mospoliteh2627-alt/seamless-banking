import 'package:flutter/material.dart';
import '../api_client.dart';
import '../app_scope.dart';
import '../models.dart';
import '../theme.dart';
import 'draft_screen.dart';
import '../widgets/step_up_sheet.dart';

class ConfirmScreen extends StatefulWidget {
  const ConfirmScreen({super.key, this.ticket, this.code});

  final String? ticket;
  final String? code;

  @override
  State<ConfirmScreen> createState() => _ConfirmScreenState();
}

class _ConfirmScreenState extends State<ConfirmScreen> {
  late Future<TicketPreview> _preview;
  bool _busy = false;
  bool _loaded = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_loaded) return;
    _loaded = true;
    _preview = AppScope.of(context).preview(ticket: widget.ticket, code: widget.code);
  }

  Future<void> _confirm() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final state = AppScope.of(context);
      final confirmed = await showStepUpSheet(context);
      if (!confirmed) return;
      if ((state.session?.authLevel ?? 1) < 2) {
        await state.stepUp(proof: 'faceid-demo');
      }
      await state.redeem(ticket: widget.ticket, code: widget.code);
      if (!mounted) return;
      await Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(builder: (_) => const DraftScreen()),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Подтверждение перехода')),
      body: FutureBuilder<TicketPreview>(
        future: _preview,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.error_outline, size: 44, color: AppColors.danger),
                    const SizedBox(height: 12),
                    Text(
                      snapshot.error is ApiException
                          ? (snapshot.error as ApiException).message
                          : 'Не удалось получить операцию',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppColors.muted),
                    ),
                    const SizedBox(height: 18),
                    OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Вернуться'),
                    ),
                  ],
                ),
              ),
            );
          }

          final preview = snapshot.data!;
          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 28),
            children: [
              const Text(
                'Найдена операция',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, letterSpacing: -0.5),
              ),
              const SizedBox(height: 6),
              Text(
                'Клиент: ${preview.ownerName}. Проверьте получателя и сумму перед продолжением.',
                style: const TextStyle(color: AppColors.muted, fontSize: 13, height: 1.45),
              ),
              const SizedBox(height: 18),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: AppColors.line),
                ),
                child: Column(
                  children: [
                    _row('Получатель', preview.recipientName),
                    _row('Банк', preview.recipientBank.isEmpty ? '—' : preview.recipientBank),
                    _row('Сумма', preview.amount.isEmpty ? 'не указана' : '${preview.amount} ₽'),
                    _row('Шаг', '${preview.step} из ${preview.totalSteps}'),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: AppColors.accent.withOpacity(0.07),
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: AppColors.accent.withOpacity(0.25)),
                ),
                child: const Column(
                  children: [
                    Icon(Icons.face_retouching_natural, size: 40, color: AppColors.accent),
                    SizedBox(height: 8),
                    Text(
                      'Face ID',
                      style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.accent),
                    ),
                    SizedBox(height: 4),
                    Text(
                      'Биометрия подтверждает, что операцию продолжает владелец устройства.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppColors.muted, fontSize: 12, height: 1.45),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 22),
              FilledButton(
                onPressed: _busy ? null : _confirm,
                child: _busy
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('Подтвердить и продолжить'),
              ),
              const SizedBox(height: 10),
              OutlinedButton(
                onPressed: _busy ? null : () => Navigator.of(context).pop(),
                child: const Text('Отмена'),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _row(String label, String value) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 13),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.line)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(color: AppColors.muted, fontSize: 12.5)),
          const SizedBox(width: 16),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}
