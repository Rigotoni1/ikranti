-- Enable existing verified-buyer bidding. Seller/listing approval, identity,
-- session, rate-limit and anti-self-bidding checks remain unchanged.
-- This flag does not configure or enable payment collection.
update ir_private.settings set trading_enabled=true where id=true;
