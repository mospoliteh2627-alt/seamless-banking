import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../api_client.dart';
import '../app_state.dart';
import '../app_scope.dart';
import '../models.dart';
import '../theme.dart';

class DraftScreen extends StatefulWidget {
  const DraftScreen({super.key});

  @override
  State<DraftScreen> createState() => _DraftScreenState();
}

class _DraftScreenState extends State<DraftScreen> {
  static const _keys = ['recipientName', 'recipientBank', 'recipientAccount', 'amount', 'purpose'];

  final Map<String, TextEditingController> _controllers = {};
  final Map<String, FocusNode> _focusNodes = {};
  final _money = NumberFormat.currency(locale: 'ru_RU', symbol: '₽', decimalDigits: 2);

  Timer? _debounce;
  bool _initialized = false;
  bool _syncing = false;
  bool _saving = false;
  bool _pending = false;
  bool _submitting = false;
  bool _saveRecipient = false;
  String _saveLabel = 'Синхронизировано с компьютером';

  @override
  void initState() {
    super.initState();
    for (final key in _keys) {
      final controller = TextEditingController();
      controller.addListener(_onChanged);
      _controllers[key] = controller;
      _focusNodes[key] = FocusNode();
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_initialized) return;
    _initialized = true;
    _syncFromState();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    for (final node in _focusNodes.values) {
      node.dispose();
    }
    super.dispose();
  }

  void _syncFromState() {
    final draft = AppScope.of(context).draft;
    if (draft == null) return;
    _syncing = true;
    for (final key in _keys) {
      _controllers[key]!.text = (draft.fields[key] ?? '').toString();
      _controllers[key]!.selection = TextSelection.collapsed(offset: _controllers[key]!.text.length);
    }
    _saveRecipient = draft.fields['saveRecipient'] == true;
    _syncing = false;
    final focus = draft.context.focus;
    if (focus != null && _focusNodes.containsKey(focus)) {
      _saveLabel = 'Восстановлен фокус: ${AppState.fieldTitle(focus)}';
    }
  }

  void _onChanged() {
    if (_syncing) return;
    setState(() => _saveLabel = 'Сохраняем…');
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 500), _save);
  }

  Map<String, dynamic> _fields() {
    final result = <String, dynamic>{
      for (final key in _keys) key: _controllers[key]!.text,
      'currency': 'RUB',
      'saveRecipient': _saveRecipient,
    };
    return result;
  }

  String _currentFocus() {
    for (final entry in _focusNodes.entries) {
      if (entry.value.hasFocus) return entry.key;
    }
    return 'amount';
  }

  Future<void> _save() async {
    if (_saving) {
      _pending = true;
      return;
    }
    final state = AppScope.of(context);
    final draft = state.draft;
    if (draft == null) return;
    _saving = true;
    final focus = _currentFocus();
    final ok = await state.saveDraft(
      fields: _fields(),
      step: draft.step,
      focus: focus,
      caret: _controllers[focus]!.selection.baseOffset,
    );
    if (!mounted) return;
    setState(() {
      _saveLabel = ok ? 'Сохранено · ${draft.version + 1}' : (state.lastError ?? 'Не сохранено');
    });
    _saving = false;
    if (_pending) {
      _pending = false;
      await _save();
    }
  }

  Future<void> _submit() async {
    final state = AppScope.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Отправить перевод?'),
        content: Text(
          '${_controllers['recipientName']!.text} · ${_money.format(_parseAmount())}',
          style: const TextStyle(color: AppColors.muted),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Отмена')),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Отправить')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _submitting = true);
    try {
      await _save();
      final receipt = await state.submit();
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Перевод отправлен'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Получатель: ${receipt.recipientName}'),
              const SizedBox(height: 6),
              Text('Сумма: ${_money.format(receipt.amount)}'),
              const SizedBox(height: 6),
              Text('Операция: ${receipt.id}', style: const TextStyle(color: AppColors.muted, fontSize: 12)),
            ],
          ),
          actions: [
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Готово'),
            ),
          ],
        ),
      );
      if (!mounted) return;
      Navigator.of(context).popUntil((route) => route.isFirst);
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  double _parseAmount() {
    final value = _controllers['amount']!.text.replaceAll(' ', '').replaceAll(',', '.');
    return double.tryParse(value) ?? 0;
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Перевод по реквизитам'),
        actions: [
          IconButton(
            onPressed: () => Navigator.of(context).popUntil((route) => route.isFirst),
            icon: const Icon(Icons.home_outlined),
            tooltip: 'На главную',
          ),
        ],
      ),
      body: ListenableBuilder(
        listenable: state,
        builder: (context, _) {
          final draft = state.draft;
          if (draft == null) {
            return const Center(child: Text('Черновик не найден'));
          }
          return ListView(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 30),
            children: [
              if (state.restoredLabel != null) _restoredBanner(state.restoredLabel!),
              _processStrip(draft),
              if (draft.updatedByDeviceId != null &&
                  draft.updatedByDeviceId != state.session?.deviceId)
                _remoteBanner(draft),
              Row(
                children: [
                  const Text(
                    'Шаг',
                    style: TextStyle(color: AppColors.muted, fontSize: 12),
                  ),
                  const SizedBox(width: 8),
                  ...List.generate(draft.totalSteps, (index) {
                    final active = index + 1 == draft.step;
                    final done = index + 1 < draft.step;
                    return Container(
                      width: 26,
                      height: 4,
                      margin: const EdgeInsets.only(right: 5),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(999),
                        color: active
                            ? AppColors.accent
                            : done
                                ? AppColors.mint
                                : AppColors.line,
                      ),
                    );
                  }),
                  const Spacer(),
                  Text(
                    '${draft.step} из ${draft.totalSteps}',
                    style: const TextStyle(color: AppColors.muted, fontSize: 12),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: AppColors.line),
                ),
                child: Column(
                  children: [
                    _field('Получатель', 'recipientName', 'Иван Петров'),
                    _field('Банк', 'recipientBank', 'Вектор Банк'),
                    _field('Счёт', 'recipientAccount', '40817 810 0 0000 0001234'),
                    _field('Сумма', 'amount', '0,00', keyboard: TextInputType.number),
                    _field('Назначение', 'purpose', 'Перевод личных средств'),
                  ],
                ),
              ),
              CheckboxListTile(
                value: _saveRecipient,
                onChanged: (value) {
                  setState(() => _saveRecipient = value ?? false);
                  _onChanged();
                },
                controlAffinity: ListTileControlAffinity.leading,
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: const Text('Сохранить получателя в избранное', style: TextStyle(fontSize: 12.5)),
              ),
              const SizedBox(height: 4),
              Row(
                children: [
                  Container(
                    width: 7,
                    height: 7,
                    decoration: const BoxDecoration(color: AppColors.mint, shape: BoxShape.circle),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _saveLabel,
                      style: const TextStyle(color: AppColors.muted, fontSize: 12),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              FilledButton(
                onPressed: _submitting ? null : _submit,
                child: _submitting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('Отправить перевод'),
              ),
              const SizedBox(height: 10),
              OutlinedButton(
                onPressed: () => Navigator.of(context).popUntil((route) => route.isFirst),
                child: const Text('На главную'),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _field(
    String label,
    String key,
    String hint, {
    TextInputType? keyboard,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          TextField(
            controller: _controllers[key],
            focusNode: _focusNodes[key],
            keyboardType: keyboard,
            decoration: InputDecoration(hintText: hint),
          ),
        ],
      ),
    );
  }

  Widget _processStrip(Draft draft) {
    final stage = draft.status == 'submitted'
        ? 4
        : draft.handoff != null
            ? 3
            : draft.step >= 3
                ? 2
                : draft.step >= 2
                    ? 1
                    : 0;
    const labels = ['Создана', 'Заполнение', 'Подтверждение', 'Переход', 'Исполнена'];
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Text('Процесс операции', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
              const Spacer(),
              Text('${(stage / 4 * 100).round()} %', style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(
              value: stage / 4,
              minHeight: 6,
              backgroundColor: AppColors.line,
              color: AppColors.accent,
            ),
          ),
          const SizedBox(height: 7),
          Row(
            children: List.generate(labels.length, (index) {
              final active = index == stage;
              final done = index < stage;
              return Expanded(
                child: Text(
                  labels[index],
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 9,
                    fontWeight: active ? FontWeight.w700 : FontWeight.w400,
                    color: done || active ? AppColors.accent : AppColors.muted,
                  ),
                ),
              );
            }),
          ),
        ],
      ),
    );
  }

  Widget _restoredBanner(String label) {
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.mint.withOpacity(0.1),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.mint.withOpacity(0.3)),
      ),
      child: Row(
        children: [
          Container(
            width: 30,
            height: 30,
            decoration: const BoxDecoration(color: AppColors.mint, shape: BoxShape.circle),
            child: const Icon(Icons.check, color: Colors.white, size: 18),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Черновик восстановлен', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                Text(label, style: const TextStyle(color: Color(0xFF0B7F6B), fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _remoteBanner(Draft draft) {
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: AppColors.accent.withOpacity(0.07),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.accent.withOpacity(0.2)),
      ),
      child: Row(
        children: [
          const Icon(Icons.sync, color: AppColors.accent, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Изменено на ${draft.updatedByDeviceName ?? 'другом устройстве'}',
              style: const TextStyle(fontSize: 12.5),
            ),
          ),
          TextButton(
            onPressed: () {
              _syncFromState();
              setState(() {});
            },
            child: const Text('Обновить'),
          ),
        ],
      ),
    );
  }
}
