-- ============================================================================
-- RoomQ Classroom Management System (NORSU - Main Campus 1)
-- MySQL 8.0+ / MariaDB 10.4+ Ready-to-Import Schema & Campus Seed Data
-- Import via phpMyAdmin, MySQL Workbench, or:
--   mysql -u root -p < schema.sql
-- ============================================================================

CREATE DATABASE IF NOT EXISTS `roomq`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `roomq`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------------------------------------------------------
-- 1. Buildings
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `buildings` (
  `id` VARCHAR(64) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_buildings_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 2. Floors
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `floors` (
  `building_id` VARCHAR(64) NOT NULL,
  `id` VARCHAR(32) NOT NULL,
  `label` VARCHAR(80) NOT NULL,
  `crop_x` DOUBLE NOT NULL,
  `crop_y` DOUBLE NOT NULL,
  `crop_width` DOUBLE NOT NULL,
  `crop_height` DOUBLE NOT NULL,
  PRIMARY KEY (`building_id`, `id`),
  CONSTRAINT `fk_floors_building`
    FOREIGN KEY (`building_id`) REFERENCES `buildings` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 3. Classrooms
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `classrooms` (
  `id` VARCHAR(128) NOT NULL,
  `building_id` VARCHAR(64) NOT NULL,
  `floor_id` VARCHAR(32) NOT NULL,
  `region_id` VARCHAR(64) NOT NULL,
  `room_number` INT NULL DEFAULT NULL,
  `name` VARCHAR(120) NULL DEFAULT NULL,
  `x` DOUBLE NOT NULL,
  `y` DOUBLE NOT NULL,
  `width` DOUBLE NOT NULL,
  `height` DOUBLE NOT NULL,
  `capacity` INT UNSIGNED NULL DEFAULT NULL,
  `facilities_json` VARCHAR(2000) NOT NULL DEFAULT '[]',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_classrooms_region` (`building_id`, `floor_id`, `region_id`),
  CONSTRAINT `fk_classrooms_floor`
    FOREIGN KEY (`building_id`, `floor_id`) REFERENCES `floors` (`building_id`, `id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 4. Users
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `first_name` VARCHAR(60) NULL DEFAULT NULL,
  `middle_name` VARCHAR(60) NULL DEFAULT NULL,
  `last_name` VARCHAR(60) NULL DEFAULT NULL,
  `full_name` VARCHAR(190) NULL DEFAULT NULL,
  `email` VARCHAR(190) NULL DEFAULT NULL,
  `password_salt` VARCHAR(64) NOT NULL,
  `password_hash` VARCHAR(128) NOT NULL,
  `role` ENUM('admin', 'staff', 'user') NOT NULL DEFAULT 'user',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_role_active` (`role`, `is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 5. Auth Sessions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `auth_sessions` (
  `token_hash` CHAR(64) NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `expires_at` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`token_hash`),
  KEY `idx_auth_sessions_user` (`user_id`),
  KEY `idx_auth_sessions_expiry` (`expires_at`),
  CONSTRAINT `fk_auth_sessions_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 6. Schedules (Classes & Reservations)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `schedules` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `kind` ENUM('class', 'reservation') NOT NULL,
  `course` VARCHAR(120) NOT NULL DEFAULT '',
  `section` VARCHAR(64) NOT NULL DEFAULT '',
  `instructor` VARCHAR(120) NOT NULL DEFAULT '',
  `classroom_id` VARCHAR(128) NULL DEFAULT NULL,
  `recurrence` ENUM('once', 'weekly') NOT NULL,
  `date` DATE NULL DEFAULT NULL,
  `days_of_week` VARCHAR(64) NOT NULL DEFAULT '[]',
  `start_date` DATE NULL DEFAULT NULL,
  `end_date` DATE NULL DEFAULT NULL,
  `start_time` CHAR(5) NOT NULL,
  `end_time` CHAR(5) NOT NULL,
  `created_by_user_id` INT UNSIGNED NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_schedules_classroom` (`classroom_id`),
  KEY `idx_schedules_dates` (`date`, `start_date`, `end_date`),
  KEY `idx_schedules_created_by` (`created_by_user_id`),
  CONSTRAINT `fk_schedules_classroom`
    FOREIGN KEY (`classroom_id`) REFERENCES `classrooms` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_schedules_created_by`
    FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `chk_schedules_time_order` CHECK (`start_time` < `end_time`),
  CONSTRAINT `chk_schedules_recurrence` CHECK (
    (`recurrence` = 'once' AND `date` IS NOT NULL AND `start_date` IS NULL AND `end_date` IS NULL)
    OR
    (`recurrence` = 'weekly' AND `date` IS NULL AND `start_date` IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 7. Activity Logs (Audit Trail)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `activity_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `actor_user_id` INT UNSIGNED NULL DEFAULT NULL,
  `actor_email` VARCHAR(190) NOT NULL,
  `action` ENUM('created', 'updated', 'deleted', 'registered', 'signed_in', 'signed_out') NOT NULL,
  `entity_type` ENUM('schedule', 'reservation', 'user', 'session') NOT NULL,
  `entity_id` VARCHAR(64) NULL DEFAULT NULL,
  `classroom_id` VARCHAR(128) NULL DEFAULT NULL,
  `previous_json` LONGTEXT NULL DEFAULT NULL,
  `updated_json` LONGTEXT NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_activity_logs_created` (`created_at`, `id`),
  KEY `idx_activity_logs_actor` (`actor_email`),
  KEY `idx_activity_logs_user` (`actor_user_id`),
  KEY `idx_activity_logs_classroom` (`classroom_id`),
  CONSTRAINT `fk_activity_logs_user`
    FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_activity_logs_classroom`
    FOREIGN KEY (`classroom_id`) REFERENCES `classrooms` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Seed Data: NORSU - Main Campus 1 (8 Buildings, 19 Floors, 102 Classrooms)
-- ============================================================================

INSERT INTO `buildings` (`id`, `name`) VALUES
  ('cas', 'CAS Building'),
  ('cba', 'CBA Building'),
  ('cthm', 'CTHM Building'),
  ('cnpahs', 'CNPAHS Building'),
  ('cit', 'CIT Building'),
  ('st', 'ST Building'),
  ('cted', 'CTED Building'),
  ('law', 'LAW Rooms')
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`);

INSERT INTO `floors` (`building_id`, `id`, `label`, `crop_x`, `crop_y`, `crop_width`, `crop_height`) VALUES
  ('cas', '3', '3rd Floor', 8, 34, 140, 53),
  ('cas', '4', '4th Floor', 8, 88, 140, 55),
  ('cba', '1', '1st Floor', 5, 369, 143, 29),
  ('cba', '2', '2nd Floor', 5, 398, 143, 35),
  ('cba', '3', '3rd Floor', 5, 436, 143, 51),
  ('cthm', '1', '1st Floor', 8, 197, 140, 31),
  ('cthm', '2', '2nd Floor', 8, 232, 140, 31),
  ('cthm', '3', '3rd Floor', 8, 266, 140, 31),
  ('cnpahs', '1', '1st Floor', 233, 30, 140, 39),
  ('cnpahs', '2', '2nd Floor', 233, 72, 140, 33),
  ('cnpahs', '3', '3rd Floor', 233, 107, 140, 32),
  ('cit', '1', '1st Floor', 233, 262, 142, 48),
  ('cit', '2', '2nd Floor', 233, 195, 142, 63),
  ('st', '1', '1st Floor', 234, 342, 141, 27),
  ('st', '2', '2nd Floor', 234, 370, 141, 22),
  ('st', '3', '3rd Floor', 234, 394, 141, 20),
  ('st', '4', '4th Floor', 234, 414, 141, 20),
  ('cted', '2', '2nd Floor', 234, 483, 141, 78),
  ('law', '1', '1st Floor', 8, 298, 140, 52)
ON DUPLICATE KEY UPDATE
  `label` = VALUES(`label`),
  `crop_x` = VALUES(`crop_x`),
  `crop_y` = VALUES(`crop_y`),
  `crop_width` = VALUES(`crop_width`),
  `crop_height` = VALUES(`crop_height`);

INSERT INTO `classrooms` (`id`, `building_id`, `floor_id`, `region_id`, `room_number`, `name`, `x`, `y`, `width`, `height`, `capacity`, `facilities_json`) VALUES
  ('cas-3-3-region-1', 'cas', '3', '3-region-1', 301, NULL, 34, 43, 16, 14, NULL, '[]'),
  ('cas-3-3-region-2', 'cas', '3', '3-region-2', 302, NULL, 52, 43, 16, 14, NULL, '[]'),
  ('cas-3-3-region-3', 'cas', '3', '3-region-3', 303, NULL, 71, 43, 15, 14, NULL, '[]'),
  ('cas-3-3-region-4', 'cas', '3', '3-region-4', 304, NULL, 89, 43, 15, 14, NULL, '[]'),
  ('cas-3-3-region-5', 'cas', '3', '3-region-5', 305, NULL, 107, 43, 15, 14, NULL, '[]'),
  ('cas-3-3-region-6', 'cas', '3', '3-region-6', 306, NULL, 125, 43, 16, 14, NULL, '[]'),
  ('cas-3-3-region-7', 'cas', '3', '3-region-7', NULL, 'Speech Lab', 16, 66, 34, 13, NULL, '[]'),
  ('cas-3-3-region-8', 'cas', '3', '3-region-8', 310, NULL, 52, 66, 16, 13, NULL, '[]'),
  ('cas-3-3-region-9', 'cas', '3', '3-region-9', 309, NULL, 89, 66, 15, 13, NULL, '[]'),
  ('cas-3-3-region-10', 'cas', '3', '3-region-10', 308, NULL, 107, 66, 15, 13, NULL, '[]'),
  ('cas-3-3-region-11', 'cas', '3', '3-region-11', 307, NULL, 125, 66, 16, 13, NULL, '[]'),
  ('cas-4-4-region-1', 'cas', '4', '4-region-1', 401, 'IRS Main', 16, 116, 34, 13, NULL, '[]'),
  ('cas-4-4-region-2', 'cas', '4', '4-region-2', 402, 'Skylab 2', 52, 116, 34, 13, NULL, '[]'),
  ('cas-4-4-region-3', 'cas', '4', '4-region-3', 403, 'Sky Lab 1', 89, 116, 34, 13, NULL, '[]'),
  ('cas-4-4-region-4', 'cas', '4', '4-region-4', 404, 'NORSU Development Center', 125, 116, 16, 13, NULL, '[]'),
  ('cba-1-1-region-1', 'cba', '1', '1-region-1', 101, NULL, 109, 374, 29, 13, NULL, '[]'),
  ('cba-2-2-region-1', 'cba', '2', '2-region-1', 201, NULL, 63, 401, 34, 13, NULL, '[]'),
  ('cba-2-2-region-2', 'cba', '2', '2-region-2', 202, NULL, 13, 423, 22, 14, NULL, '[]'),
  ('cba-2-2-region-3', 'cba', '2', '2-region-3', 203, NULL, 90, 423, 22, 14, NULL, '[]'),
  ('cba-2-2-region-4', 'cba', '2', '2-region-4', 204, NULL, 116, 423, 22, 14, NULL, '[]'),
  ('cba-3-3-region-1', 'cba', '3', '3-region-1', 301, NULL, 63, 444, 22, 13, NULL, '[]'),
  ('cba-3-3-region-2', 'cba', '3', '3-region-2', 302, NULL, 89, 444, 23, 13, NULL, '[]'),
  ('cba-3-3-region-3', 'cba', '3', '3-region-3', 303, NULL, 115, 444, 23, 13, NULL, '[]'),
  ('cba-3-3-region-4', 'cba', '3', '3-region-4', 304, NULL, 13, 466, 22, 14, NULL, '[]'),
  ('cba-3-3-region-5', 'cba', '3', '3-region-5', 305, NULL, 39, 466, 22, 14, NULL, '[]'),
  ('cba-3-3-region-6', 'cba', '3', '3-region-6', 306, NULL, 90, 466, 22, 14, NULL, '[]'),
  ('cba-3-3-region-7', 'cba', '3', '3-region-7', 307, NULL, 116, 466, 22, 14, NULL, '[]'),
  ('cthm-1-1-region-1', 'cthm', '1', '1-region-1', 101, NULL, 16, 203, 106, 13, NULL, '[]'),
  ('cthm-2-2-region-1', 'cthm', '2', '2-region-1', 201, NULL, 37, 239, 18, 13, NULL, '[]'),
  ('cthm-2-2-region-2', 'cthm', '2', '2-region-2', 202, NULL, 59, 239, 18, 13, NULL, '[]'),
  ('cthm-2-2-region-3', 'cthm', '2', '2-region-3', 203, NULL, 80, 239, 18, 13, NULL, '[]'),
  ('cthm-2-2-region-4', 'cthm', '2', '2-region-4', 204, NULL, 101, 239, 19, 14, NULL, '[]'),
  ('cthm-3-3-region-1', 'cthm', '3', '3-region-1', 301, NULL, 16, 272, 13, 13, NULL, '[]'),
  ('cthm-3-3-region-2', 'cthm', '3', '3-region-2', 302, NULL, 32, 272, 13, 13, NULL, '[]'),
  ('cthm-3-3-region-3', 'cthm', '3', '3-region-3', 303, NULL, 48, 272, 13, 13, NULL, '[]'),
  ('cthm-3-3-region-4', 'cthm', '3', '3-region-4', 304, NULL, 64, 272, 13, 13, NULL, '[]'),
  ('cthm-3-3-region-5', 'cthm', '3', '3-region-5', 305, NULL, 80, 272, 13, 13, NULL, '[]'),
  ('cthm-3-3-region-6', 'cthm', '3', '3-region-6', 306, NULL, 96, 272, 13, 13, NULL, '[]'),
  ('cthm-3-3-region-7', 'cthm', '3', '3-region-7', 307, NULL, 111, 272, 14, 13, NULL, '[]'),
  ('cthm-3-3-region-8', 'cthm', '3', '3-region-8', 308, NULL, 127, 272, 14, 13, NULL, '[]'),
  ('cnpahs-1-1-region-1', 'cnpahs', '1', '1-region-1', 101, NULL, 238, 38, 34, 13, NULL, '[]'),
  ('cnpahs-1-1-region-2', 'cnpahs', '1', '1-region-2', 102, NULL, 275, 38, 34, 13, NULL, '[]'),
  ('cnpahs-1-1-region-3', 'cnpahs', '1', '1-region-3', 103, NULL, 311, 38, 34, 13, NULL, '[]'),
  ('cnpahs-1-1-region-4', 'cnpahs', '1', '1-region-4', 104, NULL, 348, 38, 15, 13, NULL, '[]'),
  ('cnpahs-2-2-region-1', 'cnpahs', '2', '2-region-1', 201, NULL, 238, 80, 16, 14, NULL, '[]'),
  ('cnpahs-2-2-region-2', 'cnpahs', '2', '2-region-2', 202, NULL, 257, 80, 15, 14, NULL, '[]'),
  ('cnpahs-2-2-region-3', 'cnpahs', '2', '2-region-3', 203, NULL, 275, 80, 15, 14, NULL, '[]'),
  ('cnpahs-2-2-region-4', 'cnpahs', '2', '2-region-4', 204, NULL, 293, 80, 16, 14, NULL, '[]'),
  ('cnpahs-2-2-region-5', 'cnpahs', '2', '2-region-5', 205, NULL, 330, 80, 15, 14, NULL, '[]'),
  ('cnpahs-3-3-region-1', 'cnpahs', '3', '3-region-1', 301, NULL, 238, 115, 28, 13, NULL, '[]'),
  ('cnpahs-3-3-region-2', 'cnpahs', '3', '3-region-2', 302, NULL, 269, 115, 28, 13, NULL, '[]'),
  ('cnpahs-3-3-region-3', 'cnpahs', '3', '3-region-3', 303, NULL, 300, 115, 28, 13, NULL, '[]'),
  ('cnpahs-3-3-region-4', 'cnpahs', '3', '3-region-4', 304, NULL, 348, 115, 15, 13, NULL, '[]'),
  ('cit-1-1-region-1', 'cit', '1', '1-region-1', 101, NULL, 239, 267, 9, 13, NULL, '[]'),
  ('cit-1-1-region-2', 'cit', '1', '1-region-2', 102, NULL, 250, 267, 8, 13, NULL, '[]'),
  ('cit-1-1-region-3', 'cit', '1', '1-region-3', 103, NULL, 260, 267, 9, 13, NULL, '[]'),
  ('cit-1-1-region-4', 'cit', '1', '1-region-4', 104, NULL, 271, 267, 8, 13, NULL, '[]'),
  ('cit-1-1-region-5', 'cit', '1', '1-region-5', 105, NULL, 281, 267, 9, 13, NULL, '[]'),
  ('cit-1-1-region-6', 'cit', '1', '1-region-6', 106, NULL, 292, 267, 8, 13, NULL, '[]'),
  ('cit-1-1-region-7', 'cit', '1', '1-region-7', 107, NULL, 303, 267, 7, 14, NULL, '[]'),
  ('cit-1-1-region-8', 'cit', '1', '1-region-8', 108, NULL, 326, 267, 8, 13, NULL, '[]'),
  ('cit-1-1-region-9', 'cit', '1', '1-region-9', 109, NULL, 335, 267, 8, 13, NULL, '[]'),
  ('cit-1-1-region-10', 'cit', '1', '1-region-10', 110, NULL, 345, 267, 7, 13, NULL, '[]'),
  ('cit-1-1-region-11', 'cit', '1', '1-region-11', 111, NULL, 354, 267, 8, 13, NULL, '[]'),
  ('cit-1-1-region-12', 'cit', '1', '1-region-12', 112, NULL, 354, 289, 8, 13, NULL, '[]'),
  ('cit-2-2-region-1', 'cit', '2', '2-region-1', 201, NULL, 239, 199, 11, 13, NULL, '[]'),
  ('cit-2-2-region-2', 'cit', '2', '2-region-2', 202, NULL, 252, 199, 10, 13, NULL, '[]'),
  ('cit-2-2-region-3', 'cit', '2', '2-region-3', 203, NULL, 265, 199, 10, 13, NULL, '[]'),
  ('cit-2-2-region-4', 'cit', '2', '2-region-4', 204, NULL, 277, 199, 11, 13, NULL, '[]'),
  ('cit-2-2-region-5', 'cit', '2', '2-region-5', 205, NULL, 290, 199, 10, 13, NULL, '[]'),
  ('cit-2-2-region-6', 'cit', '2', '2-region-6', 206, NULL, 303, 199, 10, 13, NULL, '[]'),
  ('cit-2-2-region-7', 'cit', '2', '2-region-7', 207, NULL, 326, 199, 8, 13, NULL, '[]'),
  ('cit-2-2-region-8', 'cit', '2', '2-region-8', 208, NULL, 335, 199, 8, 13, NULL, '[]'),
  ('cit-2-2-region-9', 'cit', '2', '2-region-9', 209, NULL, 345, 199, 7, 13, NULL, '[]'),
  ('cit-2-2-region-10', 'cit', '2', '2-region-10', 210, NULL, 354, 199, 8, 13, NULL, '[]'),
  ('cit-2-2-region-11', 'cit', '2', '2-region-11', 211, NULL, 253, 225, 11, 13, NULL, '[]'),
  ('cit-2-2-region-12', 'cit', '2', '2-region-12', 212, NULL, 336, 241, 27, 13, NULL, '[]'),
  ('st-1-1-region-1', 'st', '1', '1-region-1', 101, NULL, 272, 352, 28, 13, NULL, '[]'),
  ('st-1-1-region-2', 'st', '1', '1-region-2', 102, NULL, 304, 352, 28, 13, NULL, '[]'),
  ('st-2-2-region-1', 'st', '2', '2-region-1', 201, NULL, 241, 374, 28, 13, NULL, '[]'),
  ('st-2-2-region-2', 'st', '2', '2-region-2', 202, NULL, 273, 374, 28, 13, NULL, '[]'),
  ('st-2-2-region-3', 'st', '2', '2-region-3', 203, NULL, 305, 374, 27, 13, NULL, '[]'),
  ('st-3-3-region-1', 'st', '3', '3-region-1', 301, NULL, 241, 395, 22, 14, NULL, '[]'),
  ('st-3-3-region-2', 'st', '3', '3-region-2', 302, NULL, 266, 395, 22, 14, NULL, '[]'),
  ('st-3-3-region-3', 'st', '3', '3-region-3', 303, NULL, 292, 395, 21, 14, NULL, '[]'),
  ('st-3-3-region-4', 'st', '3', '3-region-4', 304, NULL, 317, 395, 22, 14, NULL, '[]'),
  ('st-3-3-region-5', 'st', '3', '3-region-5', 305, NULL, 342, 395, 22, 14, NULL, '[]'),
  ('st-4-4-region-1', 'st', '4', '4-region-1', 401, NULL, 241, 417, 22, 14, NULL, '[]'),
  ('st-4-4-region-2', 'st', '4', '4-region-2', 402, NULL, 267, 417, 21, 14, NULL, '[]'),
  ('st-4-4-region-3', 'st', '4', '4-region-3', 403, NULL, 292, 417, 22, 14, NULL, '[]'),
  ('st-4-4-region-4', 'st', '4', '4-region-4', 404, NULL, 317, 417, 22, 14, NULL, '[]'),
  ('st-4-4-region-5', 'st', '4', '4-region-5', 405, NULL, 342, 417, 22, 14, NULL, '[]'),
  ('cted-2-2-region-1', 'cted', '2', '2-region-1', 201, NULL, 275, 494, 28, 14, NULL, '[]'),
  ('cted-2-2-region-2', 'cted', '2', '2-region-2', 202, NULL, 307, 494, 27, 14, NULL, '[]'),
  ('cted-2-2-region-3', 'cted', '2', '2-region-3', 203, NULL, 338, 494, 28, 14, NULL, '[]'),
  ('cted-2-2-region-4', 'cted', '2', '2-region-4', 204, NULL, 243, 512, 28, 14, NULL, '[]'),
  ('cted-2-2-region-5', 'cted', '2', '2-region-5', 205, NULL, 243, 530, 27, 13, NULL, '[]'),
  ('law-1-1-region-1', 'law', '1', '1-region-1', 101, 'Psych Room 1', 102, 319, 16, 16, NULL, '[]'),
  ('law-1-1-region-2', 'law', '1', '1-region-2', 102, 'Psych Room 2', 85, 313, 16, 16, NULL, '[]'),
  ('law-1-1-region-3', 'law', '1', '1-region-3', 103, 'Psych Room 3', 68, 308, 16, 16, NULL, '[]'),
  ('law-1-1-region-4', 'law', '1', '1-region-4', 104, 'Psych Room 4', 50, 305, 16, 16, NULL, '[]'),
  ('law-1-1-region-5', 'law', '1', '1-region-5', 105, 'Psych Room 5', 33, 307, 16, 16, NULL, '[]')
ON DUPLICATE KEY UPDATE
  `building_id` = VALUES(`building_id`),
  `floor_id` = VALUES(`floor_id`),
  `region_id` = VALUES(`region_id`),
  `room_number` = VALUES(`room_number`),
  `name` = VALUES(`name`),
  `x` = VALUES(`x`),
  `y` = VALUES(`y`),
  `width` = VALUES(`width`),
  `height` = VALUES(`height`);

SET FOREIGN_KEY_CHECKS = 1;
