import ReservarPublicClient from "./ui";

export default function ReservarPublicPage({ params }: { params: { slug_establecimiento: string } }) {
  return <ReservarPublicClient slug={params.slug_establecimiento} />;
}

