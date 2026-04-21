import { ProductByUidClient } from "./ui";

export default async function ProductByUidPage({
  params
}: {
  params: Promise<{ uid: string }>;
}) {
  const { uid } = await params;
  return <ProductByUidClient uid={uid} />;
}

