import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../api_client.dart';
import '../app_scope.dart';
import '../models.dart';
import '../theme.dart';
import 'confirm_screen.dart';
import 'draft_screen.dart';
import 'scan_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _money = NumberFormat.currency(locale: 'ru_RU', symbol: '₽', decimalDigits: 2);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _reload();
    });
  }

  Future<void> _reload() async {
    final state = AppScope.of(context);
    try {
      await state.loadDrafts();
    } catch (_) {
      /* список черновиков не критичен для главного экрана */
    }
    try {
      await state.loadProcesses();
    } catch (_) {
      /* процессная карта не критична для главного экрана */
    }
    try {
      await state.loadRecipients();
    } catch (_) {
      /* избранные получатели не критичны для главного экрана */
    }
  }

  Future<void> _newTransfer() async {
    final state = AppScope.of(context);
    try {
      if (state.session?.authLevel != 2) {
        await state.stepUp();
      }
      await state.createDraft();
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => const DraftScreen()),
      );
      await _reload();
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _openCodeDialog() async {
    final controller = TextEditingController();
    final code = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Код с компьютера'),
        content: TextField(
          controller: controller,
          autofocus: true,
          keyboardType: TextInputType.number,
          maxLength: 6,
          decoration: const InputDecoration(hintText: '000000', counterText: ''),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Отмена')),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, controller.text.replaceAll(RegExp(r'\D'), '')),
            child: const Text('Продолжить'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (!mounted || code == null || code.length != 6) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => ConfirmScreen(code: code)),
    );
  }

  Future<void> _openRecipient(Recipient recipient) async {
    final state = AppScope.of(context);
    try {
      await state.createDraftForRecipient(recipient);
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => const DraftScreen()),
      );
      await _reload();
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _openDraft(DraftSummary summary) async {
    try {
      await AppScope.of(context).openDraft(summary.id);
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => const DraftScreen()),
      );
      await _reload();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Не удалось открыть черновик')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final user = state.user;
    final account = user?.accounts.isNotEmpty == true ? user!.accounts.first : null;

    return Scaffold(
      body: Column(
        children: [
          Container(
            color: AppColors.ink,
            padding: EdgeInsets.fromLTRB(20, MediaQuery.of(context).padding.top + 14, 12, 18),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 21,
                  backgroundColor: AppColors.accent,
                  child: Text(
                    _initials(user?.name ?? ''),
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 13),
                  ),
                ),
                const SizedBox(width: 11),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        user?.name ?? 'Клиент',
                        style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w600),
                      ),
                      Text(
                        user?.segment ?? 'demo',
                        style: TextStyle(color: Colors.white.withOpacity(0.6), fontSize: 11.5),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: state.logout,
                  icon: const Icon(Icons.logout, color: Colors.white, size: 20),
                  tooltip: 'Выйти',
                ),
              ],
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _reload,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(18, 20, 18, 32),
                children: [
                  const Text(
                    'Здравствуйте',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.accent, letterSpacing: 1),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    (user?.name ?? '').split(' ').first,
                    style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w700, letterSpacing: -0.9),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Начните перевод на компьютере и продолжите здесь — без повторного ввода.',
                    style: TextStyle(color: AppColors.muted, fontSize: 13, height: 1.45),
                  ),
                  const SizedBox(height: 14),
                  FilledButton.icon(
                    onPressed: _newTransfer,
                    icon: const Icon(Icons.add, size: 20),
                    label: const Text('Новый перевод'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      backgroundColor: AppColors.accent,
                    ),
                  ),
                  const SizedBox(height: 18),
                  if (account != null) _balanceCard(account),
                  const SizedBox(height: 14),
                  _handoffCard(),
                  if (state.recipients.isNotEmpty) ...[
                    const SizedBox(height: 18),
                    _recipientStrip(state.recipients),
                  ],
                  if (state.processes.any((item) => item.isActive)) ...[
                    const SizedBox(height: 14),
                    _processCard(state.processes.firstWhere((item) => item.isActive)),
                  ],
                  const SizedBox(height: 22),
                  Row(
                    children: [
                      const Text(
                        'Незавершённые операции',
                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                      ),
                      const Spacer(),
                      Text(
                        '${state.drafts.length}',
                        style: const TextStyle(color: AppColors.muted, fontSize: 13),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  if (state.drafts.isEmpty)
                    Container(
                      padding: const EdgeInsets.symmetric(vertical: 22, horizontal: 16),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: AppColors.line),
                      ),
                      child: const Text(
                        'Пока нет незавершённых операций',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: AppColors.muted, fontSize: 13),
                      ),
                    )
                  else
                    ...state.drafts.map(_draftRow),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _initials(String name) {
    final parts = name.split(' ').where((part) => part.isNotEmpty).toList();
    if (parts.isEmpty) return 'ВБ';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
  }

  Widget _balanceCard(Account account) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.ink, Color(0xFF1B3F73)],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(account.title, style: TextStyle(color: Colors.white.withOpacity(0.65), fontSize: 12)),
          const SizedBox(height: 4),
          Text(
            _money.format(account.balance),
            style: const TextStyle(color: Colors.white, fontSize: 30, fontWeight: FontWeight.w700, letterSpacing: -1),
          ),
          const SizedBox(height: 2),
          Text(account.masked, style: TextStyle(color: Colors.white.withOpacity(0.5), fontSize: 12)),
        ],
      ),
    );
  }

  Widget _handoffCard() {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Подхватить операцию',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 4),
          const Text(
            'Отсканируйте QR-код на компьютере или введите шестизначный код с экрана.',
            style: TextStyle(color: AppColors.muted, fontSize: 12.5, height: 1.45),
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: () async {
              await Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const ScanScreen()),
              );
              await _reload();
            },
            icon: const Icon(Icons.qr_code_scanner, size: 20),
            label: const Text('Сканировать QR'),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _openCodeDialog,
            icon: const Icon(Icons.pin_outlined, size: 18),
            label: const Text('Ввести код'),
          ),
        ],
      ),
    );
  }

  Widget _recipientStrip(List<Recipient> recipients) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Избранные получатели', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
        const SizedBox(height: 9),
        SizedBox(
          height: 74,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: recipients.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (context, index) {
              final recipient = recipients[index];
              return InkWell(
                borderRadius: BorderRadius.circular(16),
                onTap: () => _openRecipient(recipient),
                child: Container(
                  width: 178,
                  padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: AppColors.line),
                  ),
                  child: Row(
                    children: [
                      CircleAvatar(
                        radius: 17,
                        backgroundColor: AppColors.accent.withValues(alpha: 0.10),
                        child: Text(
                          recipient.initials,
                          style: const TextStyle(color: AppColors.accent, fontSize: 11, fontWeight: FontWeight.w800),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              recipient.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
                            ),
                            Text(
                              recipient.bank.isEmpty ? recipient.account : recipient.bank,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(color: AppColors.muted, fontSize: 10.5),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _processCard(ProcessInfo process) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Text('Процесс операции', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: process.riskLabel == 'high'
                      ? AppColors.danger.withOpacity(0.12)
                      : process.riskLabel == 'medium'
                          ? AppColors.warning.withOpacity(0.14)
                          : AppColors.mint.withOpacity(0.14),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  process.riskText,
                  style: TextStyle(
                    color: process.riskLabel == 'high'
                        ? AppColors.danger
                        : process.riskLabel == 'medium'
                            ? AppColors.warning
                            : AppColors.mint,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: (process.progress / 100).clamp(0.0, 1.0),
              minHeight: 6,
              backgroundColor: AppColors.line,
              valueColor: const AlwaysStoppedAnimation<Color>(AppColors.accent),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Text(
                  process.stageLabel,
                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
                ),
              ),
              Text(
                '${process.progress}%',
                style: const TextStyle(color: AppColors.muted, fontSize: 11.5),
              ),
            ],
          ),
          const SizedBox(height: 3),
          Text(
            '${process.recipientName.isEmpty ? 'Новый перевод' : process.recipientName} · ${process.slaText}',
            style: const TextStyle(color: AppColors.muted, fontSize: 11.5),
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }

  Widget _draftRow(DraftSummary item) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => _openDraft(item),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.line),
          ),
          child: Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: AppColors.accent.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(Icons.swap_horiz, color: AppColors.accent, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.recipientName.isEmpty ? 'Новый перевод' : item.recipientName,
                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      'Шаг ${item.step} из 3 · версия ${item.version}',
                      style: const TextStyle(color: AppColors.muted, fontSize: 11.5),
                    ),
                  ],
                ),
              ),
              Text(
                item.amount.isEmpty ? '—' : item.amount,
                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5),
              ),
              const SizedBox(width: 6),
              const Icon(Icons.chevron_right, color: AppColors.muted, size: 18),
            ],
          ),
        ),
      ),
    );
  }
}
