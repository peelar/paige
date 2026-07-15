import Image from "next/image";

export default function Home() {
  return (
    <main>
      <Image src="/paige-magpie.png" alt="Paige" width={128} height={128} priority />
      <p>Paige</p>
      <h1>A small beginning.</h1>
      <p>For now, Paige answers direct messages in Slack.</p>
    </main>
  );
}
