import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';

async function main() {
  const client = new SQL(process.env.DATABASE_URL ?? 'postgresql://postgres@localhost:5432/bibel_forsker');
  const db = drizzle({ client });
  console.log('Running migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations complete.');
  client.close();
}

main().catch(console.error);
