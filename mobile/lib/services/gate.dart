import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'native.dart';

/// One step in the permission onboarding flow.
class GateStep {
  GateStep({
    required this.key,
    required this.title,
    required this.rationale,
    required this.icon,
    required this.required,
    required this.isSatisfied,
    required this.request,
  });

  final String key;
  final String title;
  final String rationale;
  final IconData icon;

  /// Hard-required steps block app access. Optional steps can be skipped.
  final bool required;

  final Future<bool> Function() isSatisfied;

  /// Returns the satisfied state after attempting to grant.
  final Future<bool> Function() request;
}

/// Lean onboarding gate — asks only what the app actually needs.
/// Re-evaluated on every cold start / resume so a revoked permission sends the
/// user back automatically.
class OnboardingGate {
  // Callyzer-style: just Call logs, Contacts, and Files — then SIM verification.
  // Recording is achieved by harvesting the phone's built-in recorder files (needs
  // Files access), so no microphone/default-dialer permission is required here.
  static List<GateStep> steps() => [
        // Call logs (permission_handler's `phone` group includes READ_CALL_LOG and
        // also covers phone state for SIM detection + call placing).
        GateStep(
          key: 'call_log',
          title: 'Call Logs',
          rationale: 'Read your calls so each one is logged and synced to the CRM.',
          icon: Icons.history,
          required: true,
          isSatisfied: () async => await Permission.phone.isGranted,
          request: () async => (await Permission.phone.request()).isGranted,
        ),
        // Contacts (caller-ID matching against contacts + leads).
        GateStep(
          key: 'contacts',
          title: 'Contacts',
          rationale: 'Show caller names by matching numbers to your contacts and leads.',
          icon: Icons.contacts_outlined,
          required: true,
          isSatisfied: () async => await Permission.contacts.isGranted,
          request: () async => (await Permission.contacts.request()).isGranted,
        ),
        // Files — all-files access to read the recordings your phone saves, so we
        // can upload both-sides call recordings to the CRM.
        GateStep(
          key: 'files',
          title: 'Files & Recordings',
          rationale: 'Access call recordings saved by your phone so they sync to the CRM.',
          icon: Icons.folder_outlined,
          required: true,
          isSatisfied: () async => await Native.instance.hasAllFilesAccess(),
          request: () async {
            if (await Native.instance.hasAllFilesAccess()) return true;
            await Native.instance.requestAllFilesAccess();
            await Future.delayed(const Duration(milliseconds: 400));
            return await Native.instance.hasAllFilesAccess();
          },
        ),
      ];

  /// Gate passes when every HARD-required step is satisfied.
  static Future<bool> isPassed() async {
    for (final s in steps()) {
      if (s.required && !await s.isSatisfied()) return false;
    }
    return true;
  }
}
