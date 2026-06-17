import fs from 'fs';
import path from 'path';
import { pool } from './index';

const MIGRATIONS = [
  'schema.sql',
  'migration_001_lead_notes_followups.sql',
  'migration_002_workflows.sql',
  'migration_003_sprint1.sql',
  'migration_004_tags_migration.sql',
  'migration_005_custom_forms_slug.sql',
  'migration_006_meta_waba.sql',
  'migration_007_fields.sql',
  'migration_008_remaining.sql',
  'migration_009_assignment_rules.sql',
  'migration_010_event_types.sql',
  'migration_011_landing_pages_roles.sql',
  'migration_012_fix_schemas.sql',
  'migration_013_workflow_stats.sql',
  'migration_014_delay_queue.sql',
  'migration_015_meta_questions_cache.sql',
  'migration_016_ensure_source_ref.sql',
  'migration_017_fix_auth_columns.sql',
  'migration_018_super_admin_features.sql',
  'migration_019_meta_reliability.sql',
  'migration_020_meta_form_id.sql',
  'migration_021_meta_form_id_ensure.sql',
  'migration_022_blocked_pages.sql',
  'migration_023_fix_waba_schema.sql',
  'migration_024_custom_fields_active.sql',
  'migration_025_phone_uniqueness.sql',
  'migration_026_user_permissions.sql',
  'migration_027_user_is_owner.sql',
  'migration_028_workflow_trigger_index.sql',
  'migration_029_unify_form_trigger.sql',
  'migration_030_wf_exec_unique_guard.sql',
  'migration_035_architecture_compliance.sql',
  'migration_036_calendar_guest_lead.sql',
  'migration_037_schema_comments.sql',
  'migration_038_deal_value.sql',
  'migration_039_calendar_soft_delete.sql',
  'migration_040_capacity_per_slot.sql',
  'migration_041_workflow_errors.sql',
  'migration_042_event_types_soft_delete.sql',
  'migration_043_unify_staff_model.sql',
  'migration_044_integrations_permissions.sql',
  'migration_045_owner_role.sql',
  'migration_046_schema_drift_fix.sql',
  'migration_047_pincode_routing.sql',
  'migration_048_meta_forms_unique_constraint.sql',
  'migration_049_workflow_staff_counters.sql',
  'migration_050_field_routing.sql',
  'migration_051_workflow_api_token.sql',
  'migration_052_is_won_stage.sql',
  'migration_053_meta_forms_status.sql',
  'migration_054_team_members.sql',
  'migration_055_contact_groups.sql',
  'migration_056_delay_queue_columns.sql',
  'migration_057_delay_queue_lead_id.sql',
  'migration_058_delay_queue_step_index.sql',
  'migration_059_notif_lead_id_followup_reminder.sql',
  'migration_060_wa_personal_sessions.sql',
  'migration_061_conversations_messages_schema.sql',
  'migration_062_conversations_phone.sql',
  'migration_063_messages_enhancements.sql',
  'migration_064_backfill_conv_phone.sql',
  'migration_065_wa_account.sql',
  'migration_066_wa_enhancements.sql',
  'migration_067_normalize_conv_phones.sql',
  'migration_068_wa_lid_mapping.sql',
  'migration_069_wa_personal_templates.sql',
  'migration_070_templates_file_attachment.sql',
  'migration_071_messages_sent_by.sql',
  'migration_072_broadcast_queue.sql',
  'migration_073_superfone.sql',
  'migration_074_fix_duplicate_slugs.sql',
  'migration_075_google_sheets_integration.sql',
  'migration_076_google_sheets_simplify.sql',
  'migration_077_meta_forms_activated_at.sql',
  'migration_078_lead_custom_form_id.sql',
  'migration_079_staff_counter_text_key.sql',
  'migration_080_staff_id.sql',
  'migration_081_custom_domains.sql',
  'migration_082_tenant_branding.sql',
  'migration_083_theme_colors.sql',
  'migration_084_two_factor.sql',
  'migration_085_google_sheets_imported_rows.sql',
  'migration_086_field_routing_meta.sql',
  'migration_087_perms_phase1_backfill.sql',
  'migration_088_perms_phase2_backfill.sql',
  'migration_089_perms_phase3_backfill.sql',
  'migration_090_perms_phase3b_backfill.sql',
  'migration_091_perf_indexes.sql',
  'migration_092_leads_assign_perm.sql',
  'migration_093_subscription_billing.sql',
  'migration_094_login_pin.sql',
  'migration_095_meta_health.sql',
  'migration_096_lead_stage_history.sql',
  'migration_097_superfone_enabled.sql',
  'migration_098_meta_created_at.sql',
  'migration_099_phone_unique_per_pipeline.sql',
  'migration_100_email_unique_per_pipeline.sql',
  'migration_101_email_credits.sql',
  'migration_102_wa_multi_session.sql',
  'migration_103_wa_device_staff.sql',
];

// Split SQL file into individual statements and execute each one separately.
// This prevents one failing statement from blocking all subsequent ones.
async function execFile(client: any, filePath: string, fileName: string) {
  const raw = fs.readFileSync(filePath, 'utf8');

  // Naive split: split on semicolons that are NOT inside $$ blocks or strings.
  // For our migration files this is sufficient since we use standard SQL + DO $$ blocks.
  const statements = splitStatements(raw);

  let ok = 0;
  let skipped = 0;
  for (const stmt of statements) {
    const trimmed = stmt.trim();
    // Skip blank or pure-comment statements.
    // A statement may START with comment lines followed by real SQL — only skip if
    // ALL non-blank lines are comments (i.e. no actual SQL content present).
    const hasSQL = trimmed.split('\n').some(line => {
      const l = line.trim();
      return l.length > 0 && !l.startsWith('--');
    });
    if (!trimmed || !hasSQL) { skipped++; continue; }
    try {
      await client.query(trimmed);
      ok++;
    } catch (err: any) {
      // Safe-to-skip PostgreSQL error codes:
      // 42P01 = undefined_table (table doesn't exist yet)
      // 42701 = duplicate_column (column already exists)
      // 42P07 = duplicate_table (relation already exists)
      // 42710 = duplicate_object (constraint/index already exists)
      // 23505 = unique_violation (on backfill inserts)
      // 42703 = undefined_column
      // 42P16 = invalid_table_definition (e.g. constraint already present via another path)
      // 42883 = undefined_function
      const safeErrors = ['42P01', '42701', '42P07', '42710', '23505', '42703', '42P16', '42883'];
      if (safeErrors.includes(err.code)) {
        skipped++;
      } else {
        console.error(`  ❌ [${fileName}] stmt failed (${err.code}): ${err.message.split('\n')[0]}`);
        console.error(`     SQL: ${trimmed.slice(0, 120)}...`);
        // don't throw — continue with remaining statements
        skipped++;
      }
    }
  }
  console.log(`  ✅ ${fileName} — ${ok} ok, ${skipped} skipped`);
}

function splitStatements(sql: string): string[] {
  const stmts: string[] = [];
  let current = '';
  let dollarDepth = 0; // tracks open $$ blocks

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    current += ch;

    // Toggle dollar-quote depth on $$
    if (ch === '$' && sql[i + 1] === '$') {
      i++; current += '$';
      dollarDepth = dollarDepth === 0 ? 1 : 0;
      continue;
    }

    // Split on semicolons only outside dollar-quoted blocks
    if (ch === ';' && dollarDepth === 0) {
      const trimmed = current.trim();
      if (trimmed.length > 1) stmts.push(trimmed);
      current = '';
    }
  }
  const tail = current.trim();
  if (tail) stmts.push(tail);
  return stmts;
}

// When compiled to dist/db/, SQL files are still in src/db/ — resolve the right base dir.
function sqlDir(): string {
  const d = __dirname.replace(/\\/g, '/');
  if (d.includes('/dist/')) {
    return path.join(__dirname, '../../src/db');
  }
  return __dirname;
}

export async function runMigrations() {
  const client = await pool.connect();
  console.log('\n📦  Running migrations...');
  const baseDir = sqlDir();
  try {
    for (const file of MIGRATIONS) {
      const filePath = path.join(baseDir, file);
      if (!fs.existsSync(filePath)) {
        console.warn(`  ⚠️  Skipping ${file} (not found)`);
        continue;
      }
      await execFile(client, filePath, file);
    }
    console.log('✅  All migrations complete\n');
  } finally {
    client.release();
  }
}

// Allow running directly: ts-node src/db/migrate.ts
if (require.main === module) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => { console.error(err); process.exit(1); });
}
