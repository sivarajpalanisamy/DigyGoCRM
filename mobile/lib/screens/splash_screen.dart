import 'package:flutter/material.dart';

/// Animated launch splash showing the Hawcus logo.
///
/// The native splash (flutter_native_splash) paints the same hawcus.png on a
/// white background instantly while the engine boots; this Flutter screen then
/// takes over and animates the logo in (fade + scale pop) plus a subtle shine,
/// then hands off to [next]. Total ~1.8s, after which it pushReplaces so the
/// splash never sits in the back stack.
class SplashScreen extends StatefulWidget {
  final Widget next;
  const SplashScreen({super.key, required this.next});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c;
  late final Animation<double> _fade;
  late final Animation<double> _scale;
  late final Animation<double> _settle;
  bool _gone = false;

  @override
  void initState() {
    super.initState();
    _c = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1300),
    );
    // Logo fades in over the first half.
    _fade = CurvedAnimation(
      parent: _c,
      curve: const Interval(0.0, 0.55, curve: Curves.easeOut),
    );
    // Pops in from slightly small with an overshoot for life.
    _scale = Tween<double>(begin: 0.78, end: 1.0).animate(
      CurvedAnimation(
        parent: _c,
        curve: const Interval(0.0, 0.7, curve: Curves.easeOutBack),
      ),
    );
    // Gentle continued breathing after the pop so it never feels frozen.
    _settle = Tween<double>(begin: 1.0, end: 1.03).animate(
      CurvedAnimation(
        parent: _c,
        curve: const Interval(0.7, 1.0, curve: Curves.easeInOut),
      ),
    );
    _c.forward();
    _c.addStatusListener((s) {
      if (s == AnimationStatus.completed) _goNext();
    });
  }

  Future<void> _goNext() async {
    if (_gone || !mounted) return;
    _gone = true;
    // Brief hold so the finished logo is readable before the handoff.
    await Future<void>.delayed(const Duration(milliseconds: 350));
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      PageRouteBuilder(
        transitionDuration: const Duration(milliseconds: 450),
        pageBuilder: (_, __, ___) => widget.next,
        transitionsBuilder: (_, anim, __, child) =>
            FadeTransition(opacity: anim, child: child),
      ),
    );
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: Center(
        child: AnimatedBuilder(
          animation: _c,
          builder: (context, _) {
            final scale = _scale.value *
                (_c.value > 0.7 ? _settle.value : 1.0);
            return Opacity(
              opacity: _fade.value,
              child: Transform.scale(
                scale: scale,
                child: Image.asset(
                  'assets/branding/hawcus.png',
                  width: 220,
                  fit: BoxFit.contain,
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
