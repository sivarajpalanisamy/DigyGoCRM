import bcrypt from 'bcryptjs';
import { pool } from './index';

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Super admin (you — the CEO) ───────────────────────────────────────────
    const superHash = await bcrypt.hash('admin123', 10);
    await client.query(`
      INSERT INTO users (email, password_hash, name, role)
      VALUES ($1, $2, $3, 'super_admin')
      ON CONFLICT DO NOTHING
    `, ['admin@digygocrm.com', superHash, 'Hawcus Admin']);

    // ── Demo tenant (a sample business) ──────────────────────────────────────
    const tenantRes = await client.query(`
      INSERT INTO tenants (name, email, plan)
      VALUES ($1, $2, 'pro')
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `, ['Saral Bakery', 'saral@demo.com']);
    const tenantId = tenantRes.rows[0].id;

    // Tenant admin
    const tenantHash = await bcrypt.hash('demo123', 10);
    await client.query(`
      INSERT INTO users (tenant_id, email, password_hash, name, role)
      VALUES ($1, $2, $3, $4, 'admin')
      ON CONFLICT DO NOTHING
    `, [tenantId, 'saral@demo.com', tenantHash, 'Saral Bakery Admin']);

    // Company settings
    await client.query(`
      INSERT INTO company_settings (tenant_id, legal_name, industry, timezone, currency)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (tenant_id) DO NOTHING
    `, [tenantId, 'Saral Bakery Pvt. Ltd.', 'Food & Beverage', 'Asia/Kolkata', 'INR']);

    // Pipeline - idempotent: reuse the existing Sales Pipeline if the seed already ran,
    // otherwise re-running seed.ts duplicates the pipeline (+ its stages + leads) and the
    // pipeline dropdown shows "Sales Pipeline" twice.
    const existingPipeline = await client.query(
      `SELECT id FROM pipelines WHERE tenant_id=$1 AND name='Sales Pipeline' ORDER BY created_at ASC LIMIT 1`,
      [tenantId]
    );
    let pipelineId: string;
    if (existingPipeline.rows[0]) {
      pipelineId = existingPipeline.rows[0].id;
    } else {
      const pipelineRes = await client.query(
        `INSERT INTO pipelines (tenant_id, name, is_default) VALUES ($1, 'Sales Pipeline', TRUE) RETURNING id`,
        [tenantId]
      );
      pipelineId = pipelineRes.rows[0].id;
    }

    // Stages - reuse existing (by name) so a re-seed doesn't duplicate stages either.
    const stages = ['New Lead', 'Contacted', 'Qualified', 'Proposal Sent', 'Won', 'Lost'];
    const stageIds: string[] = [];
    for (let i = 0; i < stages.length; i++) {
      const existingStage = await client.query(
        `SELECT id FROM pipeline_stages WHERE pipeline_id=$1 AND name=$2 LIMIT 1`,
        [pipelineId, stages[i]]
      );
      if (existingStage.rows[0]) {
        stageIds.push(existingStage.rows[0].id);
      } else {
        const r = await client.query(
          `INSERT INTO pipeline_stages (tenant_id, pipeline_id, name, stage_order)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [tenantId, pipelineId, stages[i], i]
        );
        stageIds.push(r.rows[0].id);
      }
    }

    // Demo staff member (for testing permissions)
    const staffHash = await bcrypt.hash('staff123', 10);
    await client.query(`
      INSERT INTO users (tenant_id, email, password_hash, name, role)
      VALUES ($1, $2, $3, $4, 'staff')
      ON CONFLICT DO NOTHING
    `, [tenantId, 'staff@demo.com', staffHash, 'Demo Staff']);

    const staffRes = await client.query(
      `SELECT id FROM users WHERE email='staff@demo.com' LIMIT 1`
    );
    const staffUserId = staffRes.rows[0]?.id;

    // Tenant admin user ID
    const tenantAdminRes = await client.query(
      `SELECT id FROM users WHERE email='saral@demo.com' LIMIT 1`
    );
    const tenantAdminId = tenantAdminRes.rows[0]?.id;

    // Sample leads — 3 assigned to staff, 2 unassigned
    const leadData = [
      { name: 'Aarav Sharma', email: 'aarav@example.com', phone: '+91 98765 43210', source: 'Meta Forms', stage: 0, assignTo: staffUserId },
      { name: 'Priya Nair', email: 'priya.nair@gmail.com', phone: '+91 87654 32109', source: 'Website', stage: 1, assignTo: staffUserId },
      { name: 'Rahul Mehta', email: 'rahulmehta@outlook.com', phone: '+91 76543 21098', source: 'Referral', stage: 2, assignTo: staffUserId },
      { name: 'Sunita Reddy', email: 'sunita.r@yahoo.com', phone: '+91 65432 10987', source: 'Cold Call', stage: 3, assignTo: null },
      { name: 'Kiran Patel', email: 'kiran.patel@work.com', phone: '+91 54321 09876', source: 'Website', stage: 4, assignTo: null },
    ];

    for (const lead of leadData) {
      await client.query(`
        INSERT INTO leads (tenant_id, name, email, phone, source, pipeline_id, stage_id, assigned_to)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [tenantId, lead.name, lead.email, lead.phone, lead.source, pipelineId, stageIds[lead.stage], lead.assignTo]);
    }

    // Sample notification
    await client.query(`
      INSERT INTO notifications (tenant_id, title, message, type)
      VALUES ($1, $2, $3, $4)
    `, [tenantId, 'Welcome to Hawcus CRM!', 'Your workspace is ready. Start adding leads.', 'info']);

    // Seed RBAC role_permissions
    // Admin: full access to everything; staff: only their assigned leads by default
    const adminPerms = {
      'leads:view_all': true, 'leads:create': true,
      'leads:edit': true, 'leads:delete': true, 'leads:export': true,
      'leads:import': true, 'leads:assign': true, 'pipeline:manage': true,
      'automation:view': true, 'automation:manage': true,
      'inbox:view_all': true, 'inbox:send': true,
      'calendar:view_all': true, 'calendar:manage': true,
      'staff:view': true, 'staff:manage': true, 'settings:manage': true, 'reports:view': true,
      'meta_forms:read': true, 'custom_forms:read': true, 'landing_pages:read': true,
      'contacts:read': true, 'workflows:view': true, 'fields:view': true,
      'dashboard:total_leads': true, 'dashboard:active_staff': true,
      'dashboard:conversations': true, 'dashboard:appointments': true,
    };
    // Staff by default: no leads:view_all → backend filters to assigned only
    const staffPerms = {
      'leads:create': true, 'leads:edit': true,
      'inbox:send': true, 'calendar:manage': true,
      'meta_forms:read': true, 'custom_forms:read': true,
      'contacts:read': true, 'workflows:view': true,
      'dashboard:total_leads': true,
    };
    await client.query(
      `INSERT INTO role_permissions (tenant_id, role, permissions) VALUES ($1,'admin',$2),($1,'staff',$3)
       ON CONFLICT (tenant_id, role) DO UPDATE SET permissions = EXCLUDED.permissions`,
      [tenantId, JSON.stringify(adminPerms), JSON.stringify(staffPerms)]
    );

    // Sample booking link
    await client.query(`
      INSERT INTO booking_links (tenant_id, user_id, created_by, title, name, slug, duration_mins, buffer_mins,
                                  location, description, availability, is_active)
      VALUES ($1, $2, $2, '30-min Discovery Call', '30-min Discovery Call', 'discovery-call', 30, 5,
              'Google Meet', 'Book a free 30-minute call to discuss your needs.',
              '{"monday":{"enabled":true,"start":"09:00","end":"17:00"},
                "tuesday":{"enabled":true,"start":"09:00","end":"17:00"},
                "wednesday":{"enabled":true,"start":"09:00","end":"17:00"},
                "thursday":{"enabled":true,"start":"09:00","end":"17:00"},
                "friday":{"enabled":true,"start":"09:00","end":"17:00"}}',
              TRUE)
      ON CONFLICT DO NOTHING
    `, [tenantId, tenantAdminId]);

    await client.query('COMMIT');
    console.log('✅  Seed completed');
    console.log('');
    console.log('   Super Admin → admin@digygocrm.com  / admin123');
    console.log('   Demo Tenant → saral@demo.com       / demo123');
    console.log('   Booking URL → /book/discovery-call');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌  Seed failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
