/**
 * Placeholder end-to-end test for the HTTP surface.
 *
 * The real suite will boot the NestJS app via `Test.createTestingModule` and
 * exercise `/api/health` etc. through supertest. It's skipped for now because:
 *   - The `/api/health` endpoint may not be wired yet (see health module).
 *   - Booting the full AppModule pulls in Prisma + Redis, which need real
 *     fixtures / a test container before this can run deterministically.
 *
 * Once those are available, flip `describe.skip` to `describe` and replace the
 * TODO body with an actual `request(app.getHttpServer()).get(...)` call.
 */
describe.skip('AppController (e2e) — TODO: wire AppModule + /api/health', () => {
  it('GET /api/health returns 200', () => {
    // TODO: boot the Nest app and assert the health payload:
    //
    //   const moduleRef = await Test.createTestingModule({
    //     imports: [AppModule],
    //   }).compile();
    //   const app = moduleRef.createNestApplication();
    //   app.setGlobalPrefix('api');
    //   await app.init();
    //
    //   await request(app.getHttpServer())
    //     .get('/api/health')
    //     .expect(200)
    //     .expect((res) => {
    //       expect(res.body.status).toBe('ok');
    //     });
    //
    //   await app.close();
    expect(true).toBe(true);
  });
});
