# Bundled SQLite for the dashboard

The Next.js app reads **`lead-gen.db`** from this folder when `TURSO_DATABASE_URL` is not set (recommended for Vercel: no Turso, no read limits).

## Update after running the pipeline locally

From the repo root:

```bash
cd web && npm run copy-db
```

The script copies `../data/lead-gen.db` here and runs `sqlite3` to set `journal_mode=DELETE` and checkpoint WAL so the file works on Vercel’s **read-only** filesystem (WAL mode otherwise tries to write `-wal`/`-shm` next to the file and can 500).

Then commit `web/data/lead-gen.db` and redeploy. The database is read-only at runtime on Vercel (serverless cannot persist writes).

## Size

If the file grows very large, consider [Git LFS](https://git-lfs.com/) or trimming old rows before copying.
