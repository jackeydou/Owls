export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({
    ok: true,
    service: 'owls-site-app-template',
    timestamp: new Date().toISOString()
  })
}
