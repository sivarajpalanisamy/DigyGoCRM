import 'package:flutter/material.dart';

import 'native.dart';

/// Single entry point for placing a call from anywhere in the app.
///
/// Callyzer-style: Hawcus does NOT need to be the default dialer. Tapping call
/// places it through the phone's own default dialer, which shows the in-call UI
/// and (with built-in call recording on) records it. Hawcus runs in the background
/// and harvests the recording + logs the call.
class CallLauncher {
  CallLauncher._();

  static Future<void> start(BuildContext context, String number) async {
    if (number.trim().isEmpty) return;
    await Native.instance.placeCallSystem(number);
  }
}
