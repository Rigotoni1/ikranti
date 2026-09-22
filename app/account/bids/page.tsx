import Link from "next/link";
import BidActivity from "../bid-activity";
import "../portal.css";

export default function MyBids() {
  return <main className="portal">
    <header className="portalHeader"><Link className="brand" href="/">IRKANTI</Link><span>BUYER ACCOUNT</span><Link href="/account">My account →</Link></header>
    <div className="portalBody"><BidActivity standalone /></div>
  </main>;
}
