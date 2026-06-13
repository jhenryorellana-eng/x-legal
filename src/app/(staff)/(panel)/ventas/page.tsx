/**
 * Ventas landing → /ventas/mi-dia (DOC-52 §0.2, landing route after login).
 */
import { redirect } from "next/navigation";

export default function VentasIndexPage() {
  redirect("/ventas/mi-dia");
}
