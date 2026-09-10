CREATE TABLE `auctions` (
	`id` text PRIMARY KEY NOT NULL,
	`seller_id` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`location` text NOT NULL,
	`description` text NOT NULL,
	`image_url` text NOT NULL,
	`start_price` real NOT NULL,
	`reserve_price` real NOT NULL,
	`current_bid` real NOT NULL,
	`highest_bidder_id` text,
	`bid_count` integer DEFAULT 0 NOT NULL,
	`end_at` text NOT NULL,
	`status` text DEFAULT 'live' NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`watch_count` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_auctions_status_end_at` ON `auctions` (`status`,`end_at`);--> statement-breakpoint
CREATE INDEX `idx_auctions_seller_id` ON `auctions` (`seller_id`);--> statement-breakpoint
CREATE INDEX `idx_auctions_category` ON `auctions` (`category`);--> statement-breakpoint
CREATE TABLE `bid_events` (
	`id` text PRIMARY KEY NOT NULL,
	`auction_id` text NOT NULL,
	`user_id` text NOT NULL,
	`visible_amount` real NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_bid_events_auction_created` ON `bid_events` (`auction_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `max_bids` (
	`auction_id` text NOT NULL,
	`user_id` text NOT NULL,
	`max_amount` real NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_max_bids_auction_user` ON `max_bids` (`auction_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`initials` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`joined_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `watchlist` (
	`user_id` text NOT NULL,
	`auction_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_watchlist_user_auction` ON `watchlist` (`user_id`,`auction_id`);