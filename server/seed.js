import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { hashSecret } from './lib/auth.js';
import { nowISO, todayKey } from './lib/date.js';
import { createChecklistVersion, employeeIds } from './lib/checklist.js';
import { DEFAULT_SETTINGS, DEFAULT_CLEANING_FOCUS, DEFAULT_TEAM_SIZE, defaultSectionsFor, defaultPosts } from './lib/defaults.js';

// O login é só pelo PIN, então cada funcionário nasce com um PIN diferente (e troca no primeiro acesso).
export const INITIAL_EMPLOYEE_PINS = ['1234', '5678'];
export const INITIAL_EMPLOYEE_PIN = INITIAL_EMPLOYEE_PINS[0];

/**
 * Popula o banco sem sobrescrever nada que já exista: pode rodar de novo com segurança.
 * Retorna um resumo do que foi criado.
 */
export async function seed(db, env = process.env) {
  const email = (env.MANAGER_EMAIL || '').trim().toLowerCase();
  const password = env.MANAGER_PASSWORD || '';
  if (!email || !password) {
    throw new Error('Defina MANAGER_EMAIL e MANAGER_PASSWORD no .env antes de rodar o seed.');
  }
  if (password.length < 8) {
    throw new Error('MANAGER_PASSWORD precisa ter pelo menos 8 caracteres.');
  }

  const now = nowISO();
  const created = { manager: false, employees: 0, settings: 0, checklist: false, posts: false };

  await db.transaction(async (tx) => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      created.settings += (await tx.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [key, value])).changes;
    }

    if (!(await tx.get('SELECT 1 FROM users WHERE email = ?', [email]))) {
      await tx.run(
        `INSERT INTO users (name, role, email, password_hash, created_at) VALUES (?, 'manager', ?, ?, ?)`,
        [env.MANAGER_NAME || 'Gerência', email, hashSecret(password), now],
      );
      created.manager = true;
    }

    const existing = (await tx.get("SELECT COUNT(*) AS n FROM users WHERE role = 'employee'")).n;
    for (let i = existing; i < DEFAULT_TEAM_SIZE; i++) {
      await tx.run(
        `INSERT INTO users (name, role, pin_hash, must_change_pin, created_at) VALUES (?, 'employee', ?, 1, ?)`,
        [env[`EMPLOYEE_${i + 1}_NAME`] || `Funcionário ${i + 1}`, hashSecret(INITIAL_EMPLOYEE_PINS[i]), now],
      );
      created.employees++;
    }

    if (!(await tx.get('SELECT 1 FROM checklist_versions'))) {
      const sections = defaultSectionsFor(await employeeIds(tx));
      for (let weekday = 0; weekday <= 6; weekday++) {
        await createChecklistVersion(tx, weekday, { cleaning_focus: DEFAULT_CLEANING_FOCUS[weekday], sections }, todayKey());
      }
      created.checklist = true;
    }

    // Roteiro inicial, uma vez só: se a gestora apagar tudo depois, o seed não recria.
    if (!(await tx.get("SELECT 1 FROM settings WHERE key = 'roteiro_padrao_criado'"))) {
      if (!(await tx.get('SELECT 1 FROM posts WHERE active = 1'))) {
        for (const p of defaultPosts()) {
          await tx.run(
            'INSERT INTO posts (weekday, slot, time, kind, goal, image_prompt, text_prompt) VALUES (?, 0, ?, ?, ?, ?, ?)',
            [p.weekday, p.time, p.kind, p.goal, p.image_prompt, p.text_prompt],
          );
        }
        created.posts = true;
      }
      await tx.run("INSERT INTO settings (key, value) VALUES ('roteiro_padrao_criado', '1')");
    }
  });

  return created;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = await openDb();
  try {
    const r = await seed(db);
    console.log(`Gestora: ${r.manager ? 'criada' : 'já existia'}.`);
    console.log(r.employees
      ? `Funcionários criados: ${r.employees} (PINs iniciais ${INITIAL_EMPLOYEE_PINS.join(' e ')}, troca obrigatória no primeiro acesso).`
      : 'Funcionários: já existiam.');
    console.log(`Configurações novas: ${r.settings}.`);
    console.log(`Checklist padrão: ${r.checklist ? 'criado para os 7 dias' : 'já existia'}.`);
    console.log(`Roteiro de postagens: ${r.posts ? 'criado' : 'já existia'}.`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
