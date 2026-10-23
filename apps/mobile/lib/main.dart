import 'package:flutter/material.dart';

import 'src/api_client.dart';
import 'src/app_scope.dart';
import 'src/app_state.dart';
import 'src/screens/home_screen.dart';
import 'src/screens/login_screen.dart';
import 'src/session_repository.dart';
import 'src/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final state = AppState(api: ApiClient(), repo: SessionRepository());
  await state.bootstrap();
  runApp(VectorBankApp(state: state));
}

class VectorBankApp extends StatelessWidget {
  const VectorBankApp({super.key, required this.state});

  final AppState state;

  @override
  Widget build(BuildContext context) {
    return AppScope(
      state: state,
      child: MaterialApp(
        title: 'Вектор Банк',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        home: const RootGate(),
      ),
    );
  }
}

class RootGate extends StatelessWidget {
  const RootGate({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    return ListenableBuilder(
      listenable: state,
      builder: (context, _) {
        if (!state.ready) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        return state.isAuthenticated ? const HomeScreen() : const LoginScreen();
      },
    );
  }
}
