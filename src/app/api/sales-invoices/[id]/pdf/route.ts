import { getInvoicePdf } from "@/lib/invoice123/pdf";
import { errorMessage, Invoice123Error } from "@/lib/invoice123/errors";
import { requireTenant, UnauthenticatedError } from "@/lib/tenant";

// Binary download can't go through a Server Action, hence a Route Handler.
// Same rule as the actions: tenant from the verified session, invoice must
// belong to it (getInvoicePdf filters by user_id) — another tenant's invoice
// id simply 404s.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);

  try {
    const ctx = await requireTenant();
    const { bytes, filename } = await getInvoicePdf(ctx, id, { refresh: url.searchParams.get("refresh") === "1" });
    const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return new Response("Neprisijungta", { status: 401 });
    const notFound = err instanceof Invoice123Error && err.code === "not_found";
    if (!notFound) console.error(JSON.stringify({ scope: "invoice-pdf-route", invoice: id, error: errorMessage(err) }));
    const message = err instanceof Invoice123Error ? err.userMessage : "Nepavyko gauti PDF.";
    return new Response(message, { status: notFound ? 404 : 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
