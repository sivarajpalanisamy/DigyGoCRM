import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../theme.dart';
import '../services/gate.dart';

/// Permission onboarding. One card per permission; granting auto-advances to the
/// next step. Required steps must be granted; optional ones can be skipped.
class OnboardingGateScreen extends StatefulWidget {
  const OnboardingGateScreen({super.key, required this.onComplete});
  final Future<void> Function() onComplete;

  @override
  State<OnboardingGateScreen> createState() => _OnboardingGateScreenState();
}

class _OnboardingGateScreenState extends State<OnboardingGateScreen> {
  late final List<GateStep> _steps = OnboardingGate.steps();
  int _index = 0;
  bool _busy = false;
  bool _satisfied = false;
  bool _permanentlyDenied = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  GateStep get _step => _steps[_index];

  Future<void> _refresh() async {
    final ok = await _step.isSatisfied();
    if (mounted) setState(() => _satisfied = ok);
  }

  Future<void> _grant() async {
    setState(() => _busy = true);
    final ok = await _step.request();
    bool permaDenied = false;
    // 'files' is a Settings toggle (not a runtime dialog), so never treat as permanently denied.
    if (!ok && _step.key != 'files') {
      permaDenied = await _isPermanentlyDenied(_step.key);
    }
    if (!mounted) return;
    setState(() {
      _busy = false;
      _satisfied = ok;
      _permanentlyDenied = permaDenied;
    });
    // Auto-advance once granted — no manual Continue needed.
    if (ok) {
      await Future.delayed(const Duration(milliseconds: 550));
      if (mounted) _next();
    }
  }

  Future<bool> _isPermanentlyDenied(String key) async {
    switch (key) {
      case 'call_log':
        return await Permission.phone.isPermanentlyDenied;
      case 'contacts':
        return await Permission.contacts.isPermanentlyDenied;
      default:
        return false;
    }
  }

  Future<void> _next() async {
    if (_index < _steps.length - 1) {
      setState(() {
        _index++;
        _satisfied = false;
        _permanentlyDenied = false;
      });
      await _refresh();
      // If the next step is already satisfied, keep moving.
      if (_satisfied) {
        await Future.delayed(const Duration(milliseconds: 350));
        if (mounted) _next();
      }
    } else {
      if (await OnboardingGate.isPassed()) {
        await widget.onComplete();
      } else {
        for (var i = 0; i < _steps.length; i++) {
          if (_steps[i].required && !await _steps[i].isSatisfied()) {
            setState(() {
              _index = i;
              _satisfied = false;
            });
            await _refresh();
            break;
          }
        }
      }
    }
  }

  String _actionLabel(GateStep s) {
    switch (s.key) {
      case 'default_dialer':
        return 'Set as Default Dialer';
      case 'notifications':
        return 'Enable Notifications';
      default:
        return 'Allow Access';
    }
  }

  @override
  Widget build(BuildContext context) {
    final step = _step;

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 20, 24, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Progress
              Row(
                children: List.generate(_steps.length, (i) {
                  final active = i <= _index;
                  return Expanded(
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 250),
                      height: 5,
                      margin: const EdgeInsets.symmetric(horizontal: 3),
                      decoration: BoxDecoration(
                        color: active ? Brand.accent : const Color(0x1A000000),
                        borderRadius: BorderRadius.circular(3),
                      ),
                    ),
                  );
                }),
              ),
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Step ${_index + 1} of ${_steps.length}',
                      style: const TextStyle(fontSize: 13, color: Brand.muted, fontWeight: FontWeight.w500)),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                    decoration: BoxDecoration(
                      color: step.required ? const Color(0x14C2410C) : const Color(0x0F000000),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      step.required ? 'Required' : 'Optional',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: step.required ? Brand.primary : Brand.muted,
                      ),
                    ),
                  ),
                ],
              ),
              const Spacer(),
              // Icon
              AnimatedSwitcher(
                duration: const Duration(milliseconds: 250),
                child: Container(
                  key: ValueKey(step.key),
                  width: 104,
                  height: 104,
                  decoration: BoxDecoration(
                    color: _satisfied ? const Color(0x1A22C55E) : const Color(0x14EA580C),
                    borderRadius: BorderRadius.circular(30),
                  ),
                  child: Icon(
                    _satisfied ? Icons.check_rounded : step.icon,
                    size: 50,
                    color: _satisfied ? const Color(0xFF16A34A) : Brand.accent,
                  ),
                ),
              ),
              const SizedBox(height: 30),
              Text(step.title,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 25, fontWeight: FontWeight.w800, color: Brand.ink)),
              const SizedBox(height: 12),
              Text(step.rationale,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 15.5, color: Brand.muted, height: 1.5)),
              const Spacer(),
              // Primary action
              if (_satisfied)
                Container(
                  height: 54,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: const Color(0x1A22C55E),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.check_circle, color: Color(0xFF16A34A), size: 22),
                      SizedBox(width: 8),
                      Text('Granted',
                          style: TextStyle(color: Color(0xFF16A34A), fontWeight: FontWeight.w700, fontSize: 16)),
                    ],
                  ),
                )
              else if (_permanentlyDenied)
                Column(
                  children: [
                    const Text('Permission was blocked. Enable it in Settings.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Brand.muted, fontSize: 13)),
                    const SizedBox(height: 10),
                    FilledButton.icon(
                      onPressed: _busy ? null : openAppSettings,
                      icon: const Icon(Icons.settings, size: 20),
                      label: const Text('Open Settings'),
                    ),
                  ],
                )
              else
                FilledButton.icon(
                  onPressed: _busy ? null : _grant,
                  icon: _busy
                      ? const SizedBox(
                          height: 20, width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : Icon(step.icon, size: 20),
                  label: Text(_busy ? 'Requesting…' : _actionLabel(step)),
                ),
              const SizedBox(height: 8),
              // Skip — ONLY for optional steps that aren't yet granted.
              if (!step.required && !_satisfied)
                TextButton(
                  onPressed: _busy ? null : _next,
                  style: TextButton.styleFrom(
                    minimumSize: const Size.fromHeight(44),
                    foregroundColor: Brand.muted,
                  ),
                  child: Text(
                    _index == _steps.length - 1 ? 'Finish' : 'Skip',
                    style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
                  ),
                )
              else
                const SizedBox(height: 44), // keep layout stable; no skip on required steps
            ],
          ),
        ),
      ),
    );
  }
}
