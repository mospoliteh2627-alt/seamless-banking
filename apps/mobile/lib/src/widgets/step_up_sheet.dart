import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme.dart';

Future<bool> showStepUpSheet(BuildContext context) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    barrierColor: AppColors.ink.withValues(alpha: 0.55),
    builder: (_) => const StepUpSheet(),
  );
  return result ?? false;
}

class StepUpSheet extends StatefulWidget {
  const StepUpSheet({super.key});

  @override
  State<StepUpSheet> createState() => _StepUpSheetState();
}

class _StepUpSheetState extends State<StepUpSheet> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse;
  bool _scanning = false;
  bool _pinMode = false;
  String _pin = '';
  String? _error;
  Timer? _errorTimer;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 1600))..repeat();
  }

  @override
  void dispose() {
    _errorTimer?.cancel();
    _pulse.dispose();
    super.dispose();
  }

  Future<void> _faceScan() async {
    if (_scanning) return;
    HapticFeedback.mediumImpact();
    setState(() {
      _scanning = true;
      _error = null;
    });
    await Future<void>.delayed(const Duration(milliseconds: 1250));
    if (!mounted) return;
    HapticFeedback.heavyImpact();
    Navigator.of(context).pop(true);
  }

  void _tapDigit(String digit) {
    if (_pin.length >= 4) return;
    HapticFeedback.lightImpact();
    setState(() {
      _pin += digit;
      _error = null;
    });
    if (_pin.length == 4) {
      if (_pin == '0000') {
        HapticFeedback.heavyImpact();
        Navigator.of(context).pop(true);
      } else {
        _error = 'Неверный PIN. Демо-код: 0000';
        _errorTimer?.cancel();
        _errorTimer = Timer(const Duration(milliseconds: 700), () {
          if (mounted) setState(() => _pin = '');
        });
      }
    }
  }

  void _backspace() {
    if (_pin.isEmpty) return;
    HapticFeedback.selectionClick();
    setState(() => _pin = _pin.substring(0, _pin.length - 1));
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: bottom),
      child: Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 10, 24, 22),
            child: AnimatedSize(
              duration: const Duration(milliseconds: 220),
              curve: Curves.easeOut,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 42,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.line,
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                  const SizedBox(height: 18),
                  const Text(
                    'Подтверждение личности',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, letterSpacing: -0.3),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _pinMode ? 'Введите PIN демо-карты' : 'Биометрия подтверждает, что операцию продолжает владелец устройства',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: AppColors.muted, fontSize: 12.5, height: 1.45),
                  ),
                  const SizedBox(height: 18),
                  if (_pinMode) _pinPanel() else _facePanel(),
                  const SizedBox(height: 8),
                  if (!_pinMode)
                    TextButton(
                      onPressed: _scanning ? null : () => setState(() => _pinMode = true),
                      child: const Text('Ввести PIN вручную'),
                    )
                  else
                    TextButton(
                      onPressed: () => setState(() {
                        _pinMode = false;
                        _pin = '';
                        _error = null;
                      }),
                      child: const Text('Вернуться к Face ID'),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _facePanel() {
    return Column(
      children: [
        SizedBox(
          width: 148,
          height: 148,
          child: AnimatedBuilder(
            animation: _pulse,
            builder: (context, _) {
              final t = _pulse.value;
              return Stack(
                alignment: Alignment.center,
                children: [
                  for (final offset in [0.0, 0.33, 0.66])
                    Opacity(
                      opacity: (1 - ((t + offset) % 1)) * 0.35,
                      child: Transform.scale(
                        scale: 0.72 + ((t + offset) % 1) * 0.5,
                        child: Container(
                          width: 138,
                          height: 138,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(color: AppColors.accent, width: 1.2),
                          ),
                        ),
                      ),
                    ),
                  Container(
                    width: 92,
                    height: 92,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: AppColors.accent.withValues(alpha: 0.10),
                    ),
                    child: Icon(
                      _scanning ? Icons.face_retouching_natural : Icons.face,
                      color: AppColors.accent,
                      size: 46,
                    ),
                  ),
                ],
              );
            },
          ),
        ),
        const SizedBox(height: 4),
        Text(
          _scanning ? 'Сканируем Face ID…' : 'Face ID готов',
          style: TextStyle(
            color: _scanning ? AppColors.accent : AppColors.ink,
            fontSize: 13,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 14),
        FilledButton.icon(
          onPressed: _scanning ? null : _faceScan,
          icon: _scanning
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Icon(Icons.face_retouching_natural, size: 20),
          label: Text(_scanning ? 'Проверяем…' : 'Подтвердить Face ID'),
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
        ),
      ],
    );
  }

  Widget _pinPanel() {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(
            4,
            (index) => Container(
              width: 16,
              height: 16,
              margin: const EdgeInsets.symmetric(horizontal: 7),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: index < _pin.length ? AppColors.accent : AppColors.line,
              ),
            ),
          ),
        ),
        SizedBox(
          height: 26,
          child: Center(
            child: Text(
              _error ?? 'Демо-код: 0000',
              style: TextStyle(
                color: _error == null ? AppColors.muted : AppColors.danger,
                fontSize: 11.5,
                fontWeight: _error == null ? FontWeight.w400 : FontWeight.w600,
              ),
            ),
          ),
        ),
        GridView.count(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisCount: 3,
          childAspectRatio: 2.4,
          mainAxisSpacing: 4,
          crossAxisSpacing: 8,
          children: keys.map((key) {
            if (key.isEmpty) return const SizedBox.shrink();
            final isBack = key == '⌫';
            return TextButton(
              onPressed: isBack ? _backspace : () => _tapDigit(key),
              style: TextButton.styleFrom(
                foregroundColor: AppColors.ink,
                textStyle: const TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
              ),
              child: Text(key),
            );
          }).toList(),
        ),
      ],
    );
  }
}
