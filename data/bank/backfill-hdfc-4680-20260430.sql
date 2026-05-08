-- Auto-generated from HDFC account statement, 2026-05-01T11:02:10.219110
-- 260 transactions — INSERT OR IGNORE is idempotent against
-- money_events(source, source_ref) and
-- money_events(source, instrument, direction, amount_paise, txn_at).
--
-- NOTE: no BEGIN/COMMIT — D1 rejects explicit transactions in --file
-- execution. Wrangler wraps the file in its own transaction internally.

INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000753746', 'debit', 12500, 33438, 'card', '753746 01APR26 02:48:52 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 753746 01APR26 02:48:52 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-01T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP60915298202', 'credit', 161981, 195419, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60915298202', '2026-04-01T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000001551401920', 'credit', 388597, 584016, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SY5C5BCCGLP54W', 'FT- SY5C5BCCGLP54W - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-04-01T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000FTIMPS432561', 'debit', 500000, 84016, 'ft', 'SHAHEEN EXP-AHMED SHAHEEN-FTIMPS432561', '50100787755360', 'FT-50100787755360-SHAHEEN EXP-AHMED SHAHEEN-FTIMPS432561', '2026-04-01T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 3, 'matched: Ahmed Shaheen [unknown]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000743669', 'debit', 48000, 36016, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 743669 01APR26 16:37:40 BANGALORE SWIGGY', '2026-04-01T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'swiggy', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000001552070306', 'credit', 293701, 329717, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SYDN3AWO63HEEZ', 'FT- SYDN3AWO63HEEZ - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-04-01T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000609196152534', 'credit', 349917, 679634, 'imps', 'PAYTM', NULL, 'IMPS-609196152534-PAYTM PAYMENTS SERVICES LIMITED PA ESCROW AC-YESB-XXXXXXXXXXX0058-AWSPG2026040100010ZPRZUL15432995875', '2026-04-01T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00903436673', 'debit', 500000, 179634, 'neft', 'ROYAL POLYMERS-NETBANK, MUM-HDFCH00903436673-FOR MATS', 'IDIB000B075', 'NEFT DR-IDIB000B075-ROYAL POLYMERS-NETBANK, MUM-HDFCH00903436673-FOR MATS', '2026-04-01T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 23, 'matched: Royal Polymers Mats [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000200561', 'debit', 65400, 114234, 'card', '200561 01APR26 22:03:24 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 200561 01APR26 22:03:24 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-01T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000400437', 'debit', 13900, 100334, 'card', '400437 02APR26 00:06:19 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 400437 02APR26 00:06:19 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-02T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000605487', 'debit', 12500, 87834, 'card', '605487 02APR26 03:02:08 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 605487 02APR26 03:02:08 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-02T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP60924537167', 'credit', 184400, 272234, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60924537167', '2026-04-02T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000001553354024', 'credit', 811142, 1083376, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SYTKLZEZMNIMMY', 'FT- SYTKLZEZMNIMMY - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-04-02T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00905207961', 'debit', 1000000, 83376, 'neft', 'SK OSIMAKRAM-NETBANK, MUM-HDFCH00905207961-SALARY SETTLEMENT', 'SBIN0002014', 'NEFT DR-SBIN0002014-SK OSIMAKRAM-NETBANK, MUM-HDFCH00905207961-SALARY SETTLEMENT', '2026-04-02T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'XLS_202604_0014', 'credit', 1260000, 1343376, 'cash_deposit', 'CASH DEPOSIT', NULL, 'CASH DEPOSIT BY - SELF - FRAZER TOWN, BANG', '2026-04-02T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESF360926443902', 'credit', 100, 1343476, 'neft', 'EAZYDINER', 'YESB0000001', 'NEFT CR-YESB0000001-EAZYDINER PRIVATE LIMITED-HN HOTELS PRIVATE LIMITED-YESF360926443902', '2026-04-02T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'eazydiner', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000609258568265', 'credit', 419588, 1763064, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609258568265-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-02T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'XLS_202604_0017', 'credit', 200, 1763264, 'card_refund', 'GOOGLESERVIS', NULL, 'CRV POS 514834******7103 GOOGLESERVIS', '2026-04-02T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00906646916', 'debit', 1000000, 763264, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00906646916-PETTY CASH', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00906646916-PETTY CASH', '2026-04-02T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 28, 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00906962308', 'debit', 300000, 463264, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00906962308-UP TO 31ST PAID', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00906962308-UP TO 31ST PAID', '2026-04-02T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00907058719', 'debit', 400000, 63264, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00907058719-PETTY CASH', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00907058719-PETTY CASH', '2026-04-02T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 28, 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000865209', 'debit', 27500, 35764, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 865209 02APR26 21:26:21 GURGAON WWW SWIGGY COM', '2026-04-02T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'swiggy', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP60934523847', 'credit', 290400, 326164, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60934523847', '2026-04-03T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000609360933220', 'credit', 850093, 1176257, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609360933220-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-03T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00907711825', 'debit', 775000, 401257, 'neft', 'JAY AND JAY DEHYDRO FOODS PRIVATE LIMITE-NETBANK, MUM-HDFCH00907711825-INVOICED ', 'UTIB0000194', 'NEFT DR-UTIB0000194-JAY AND JAY DEHYDRO FOODS PRIVATE LIMITE-NETBANK, MUM-HDFCH00907711825-INVOICED 30TH MARC', '2026-04-03T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00907889549', 'debit', 400000, 1257, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00907889549-PETTY CASH', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00907889549-PETTY CASH', '2026-04-03T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 28, 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000001556374542', 'credit', 492123, 493380, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SZ0S8E1ENKPWFE', 'FT- SZ0S8E1ENKPWFE - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-04-03T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000094155', 'debit', 48000, 445380, 'card', '094155 03APR26 17:44:54 BANGALORE PHONEPE PRIV*ZEPTO MAR', NULL, 'POS 514834XXXXXX7103 094155 03APR26 17:44:54 BANGALORE PHONEPE PRIV*ZEPTO MAR', '2026-04-03T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000633939', 'debit', 11310, 434070, 'card_subscription', 'GOOGLECLOUD', NULL, 'ME DC SI 514834XXXXXX7103 GOOGLECLOUD', '2026-04-04T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000732256', 'debit', 13000, 421070, 'card', '732256 04APR26 01:13:33 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 732256 04APR26 01:13:33 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-04T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP60944407566', 'credit', 631600, 1052670, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60944407566', '2026-04-04T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000643361', 'debit', 13000, 1039670, 'card', '643361 04APR26 05:45:35 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 643361 04APR26 05:45:35 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-04T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000001557145051', 'credit', 939715, 1979385, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SZGO8XVFOWUDR6', 'FT- SZGO8XVFOWUDR6 - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-04-04T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000876882', 'debit', 29200, 1950185, 'card', '876882 04APR26 11:55:03 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 876882 04APR26 11:55:03 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-04T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000609465904788', 'credit', 520271, 2470456, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609465904788-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-04T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00911064601', 'debit', 300000, 2170456, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00911064601-UPTO 31ST MAR CLOS', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00911064601-UPTO 31ST MAR CLOS', '2026-04-04T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000609444428855', 'debit', 1500000, 670456, 'imps', 'TANVEER AHMED-SBIN-XXXXXXX8124-PETTY CASH', NULL, 'IMPS-609444428855-TANVEER AHMED-SBIN-XXXXXXX8124-PETTY CASH', '2026-04-04T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 28, 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00911131705', 'debit', 650000, 20456, 'neft', 'ROYAL POLYMERS-NETBANK, MUM-HDFCH00911131705-DOOR MATS', 'IDIB000B075', 'NEFT DR-IDIB000B075-ROYAL POLYMERS-NETBANK, MUM-HDFCH00911131705-DOOR MATS', '2026-04-04T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 23, 'matched: Royal Polymers Mats [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000387246', 'debit', 19300, 1156, 'card', '387246 04APR26 23:02:28 BANGALORE FLIPKART INTERNET PVT', NULL, 'POS 514834XXXXXX7103 387246 04APR26 23:02:28 BANGALORE FLIPKART INTERNET PVT', '2026-04-04T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP60954627461', 'credit', 930380, 931536, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60954627461', '2026-04-05T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000609568338991', 'credit', 1107158, 2038694, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609568338991-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-05T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000518986', 'debit', 21600, 2017094, 'card', '518986 05APR26 11:20:29 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 518986 05APR26 11:20:29 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-05T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00911623058', 'debit', 2000000, 17094, 'neft', 'AJIM MOHAMMAD-NETBANK, MUM-HDFCH00911623058-DAILY SALARY', 'UTIB0002321', 'NEFT DR-UTIB0002321-AJIM MOHAMMAD-NETBANK, MUM-HDFCH00911623058-DAILY SALARY', '2026-04-05T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 4, 'matched: Ajim Mohammad Head Cook Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000001559199739', 'credit', 571571, 588665, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SZNVVVWNRAVULE', 'FT- SZNVVVWNRAVULE - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-04-05T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'XLS_202604_0044', 'credit', 200, 588865, 'card_refund', 'GOOGLECLOUD', NULL, 'CRV POS 514834******7103 GOOGLECLOUD', '2026-04-05T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000609569778347', 'credit', 876800, 1465665, 'imps', 'PAYTM', NULL, 'IMPS-609569778347-PAYTMPAYMENTSSERVICESLTDPAYMENTAGGREGATORESCR-UTIB-XXXXXXXXXXX2533-IMPS', '2026-04-05T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000001559273863', 'credit', 293578, 1759243, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SZPBAOOT200HCM', 'FT- SZPBAOOT200HCM - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-04-05T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00911739609', 'debit', 1000000, 759243, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00911739609-DAILY SALARY', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00911739609-DAILY SALARY', '2026-04-05T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 19, 'matched: Mujib Tea Master Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00911742385', 'debit', 500000, 259243, 'neft', 'ARBEEN TAJ-NETBANK, MUM-HDFCH00911742385-SALARY ADVANCE', 'SBIN0014933', 'NEFT DR-SBIN0014933-ARBEEN TAJ-NETBANK, MUM-HDFCH00911742385-SALARY ADVANCE', '2026-04-05T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00911763705', 'debit', 200000, 59243, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00911763705-UPTO 4 MARCH CLOSE', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00911763705-UPTO 4 MARCH CLOSE', '2026-04-05T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000609520548433', 'credit', 9254400, 9313643, 'imps', 'B NAVEEN KUMAR-FDRL-XXXXXXXXXX1370-HN HOTELS PRIVATE LIMITED', NULL, 'IMPS-609520548433-B NAVEEN KUMAR-FDRL-XXXXXXXXXX1370-HN HOTELS PRIVATE LIMITED', '2026-04-05T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 7, 'matched: B Naveen Kumar [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000244537', 'debit', 20300, 9293343, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 244537 05APR26 20:48:00 BANGALORE PAY*SWIGGY', '2026-04-05T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'swiggy', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000250928', 'debit', 32100, 9261243, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 250928 05APR26 22:12:01 BANGALORE PAY*SWIGGY', '2026-04-05T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'swiggy', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000133765', 'debit', 19100, 9242143, 'card', '133765 05APR26 23:36:16 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 133765 05APR26 23:36:16 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-05T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000523385', 'debit', 17600, 9224543, 'card', '523385 06APR26 00:02:53 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 523385 06APR26 00:02:53 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-06T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP60964509594', 'credit', 323962, 9548505, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60964509594', '2026-04-06T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000001559749943', 'credit', 791972, 10340477, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SA3U9FT2CSLZEK', 'FT- SA3U9FT2CSLZEK - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-04-06T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000641954', 'debit', 22100, 10318377, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 641954 06APR26 11:26:16 GURGAON PAY*WWW.SWIGGY.COM', '2026-04-06T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'swiggy', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000670392', 'debit', 20700, 10297677, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 670392 06APR26 12:31:39 GURGAON PAY*WWW.SWIGGY.COM', '2026-04-06T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'swiggy', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000670619', 'debit', 20400, 10277277, 'card', '670619 06APR26 12:51:37 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 670619 06APR26 12:51:37 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-06T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000718366', 'debit', 28900, 10248377, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 718366 06APR26 14:28:46 GURGAON PAY*WWW.SWIGGY.COM', '2026-04-06T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'swiggy', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000732056', 'debit', 200000, 10048377, 'card_subscription', 'GOOGLECLOUD', NULL, 'ME DC SI 514834XXXXXX7103 GOOGLECLOUD', '2026-04-06T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000746151', 'debit', 50600, 9997777, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 746151 06APR26 15:40:17 GURGAON PAY*WWW.SWIGGY.COM', '2026-04-06T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'swiggy', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000609673113252', 'credit', 389822, 10387599, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609673113252-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-06T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'XLS_202604_0064', 'credit', 13000, 10400599, 'card_refund', 'ZEPTO909NPLCYBS', NULL, 'CRV POS 514834******7103 ZEPTO909NPLCYBS', '2026-04-06T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000932300', 'debit', 37500, 10363099, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 932300 07APR26 00:09:06 GURGAON PAY*WWW.SWIGGY.COM', '2026-04-07T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'swiggy', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP60974384547', 'credit', 334600, 10697699, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60974384547', '2026-04-07T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000609775436678', 'credit', 831579, 11529278, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609775436678-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-07T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000074423', 'debit', 200, 11529078, 'card', '074423 07APR26 12:31:47 MUMBAI GOOGLECLOUD', NULL, 'POS 514834XXXXXX7103 074423 07APR26 12:31:47 MUMBAI GOOGLECLOUD', '2026-04-07T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000085004', 'debit', 200, 11528878, 'card', '085004 07APR26 12:57:13 MUMBAI GOOGLECLOUD', NULL, 'POS 514834XXXXXX7103 085004 07APR26 12:57:13 MUMBAI GOOGLECLOUD', '2026-04-07T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000087981', 'debit', 200, 11528678, 'card', '087981 07APR26 13:04:45 MUMBAI GOOGLECLOUD', NULL, 'POS 514834XXXXXX7103 087981 07APR26 13:04:45 MUMBAI GOOGLECLOUD', '2026-04-07T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00917457082', 'debit', 1000000, 10528678, 'neft', 'NAZEER NADEEM-NETBANK, MUM-HDFCH00917457082-NBEQANQNUBC340ZR', 'IDFB0080176', 'NEFT DR-IDFB0080176-NAZEER NADEEM-NETBANK, MUM-HDFCH00917457082-NBEQANQNUBC340ZR', '2026-04-07T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00917724952', 'debit', 1000000, 9528678, 'neft', 'SHEIKH FAHEEMUL YOUSUF-NETBANK, MUM-HDFCH00917724952-SALARY ADVANCE', 'KKBK0008066', 'NEFT DR-KKBK0008066-SHEIKH FAHEEMUL YOUSUF-NETBANK, MUM-HDFCH00917724952-SALARY ADVANCE', '2026-04-07T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 25, 'matched: Sheikh Faheemul Staff Salary [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000609776805325', 'credit', 416341, 9945019, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609776805325-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-07T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000670721', 'debit', 75100, 9869919, 'card', '670721 07APR26 17:25:54 GURGAON BLINKIT', NULL, 'POS 514834XXXXXX7103 670721 07APR26 17:25:54 GURGAON BLINKIT', '2026-04-07T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000224093', 'debit', 17000, 9852919, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 224093 07APR26 19:03:59 GURGAON PAY*WWW.SWIGGY.COM', '2026-04-07T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'swiggy', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000318289', 'debit', 30100, 9822819, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 318289 07APR26 23:30:11 GURGAON PAY*WWW.SWIGGY.COM', '2026-04-07T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'swiggy', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000689185', 'debit', 20711, 9802108, 'card', 'ZOMATO', NULL, 'POS 514834XXXXXX7103 689185 08APR26 01:29:35 GURGAON ZOMATO ONLINE ORDER', '2026-04-08T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'zomato_delivery', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP60984508111', 'credit', 617000, 10419108, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60984508111', '2026-04-08T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000346805', 'debit', 34400, 10384708, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 346805 08APR26 06:40:29 GURGAON PAY*WWW.SWIGGY.COM', '2026-04-08T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'swiggy', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000609879091597', 'credit', 802546, 11187254, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609879091597-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-08T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000390831', 'debit', 25400, 11161854, 'card', '390831 08APR26 09:18:12 MUMBAI ZEPTO', NULL, 'POS 514834XXXXXX7103 390831 08APR26 09:18:12 MUMBAI ZEPTO', '2026-04-08T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000609880544207', 'credit', 429008, 11590862, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609880544207-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-08T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00922084836', 'debit', 600000, 10990862, 'neft', 'MOHAMMED ISMAIL-NETBANK, MUM-HDFCH00922084836-WEEKLY SALARY', 'JAKA0FRAZER', 'NEFT DR-JAKA0FRAZER-MOHAMMED ISMAIL-NETBANK, MUM-HDFCH00922084836-WEEKLY SALARY', '2026-04-08T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 17, 'matched: Mohammed Ismail Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00922608378', 'debit', 1000000, 9990862, 'neft', 'SHAIK NOOR AHMED-NETBANK, MUM-HDFCH00922608378-SALARY ADVANCE', 'IOBA0003604', 'NEFT DR-IOBA0003604-SHAIK NOOR AHMED-NETBANK, MUM-HDFCH00922608378-SALARY ADVANCE', '2026-04-08T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 22, 'matched: Noor Ahmed Employee Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000473917', 'debit', 51000, 9939862, 'card', '473917 08APR26 19:28:23 GURGAON BLINKIT', NULL, 'POS 514834XXXXXX7103 473917 08APR26 19:28:23 GURGAON BLINKIT', '2026-04-08T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00922706408', 'debit', 500000, 9439862, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00922706408-PETTY CASH', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00922706408-PETTY CASH', '2026-04-08T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 28, 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000638923', 'debit', 57100, 9382762, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 638923 08APR26 19:54:21 BANGALORE RSP*SWIGGY', '2026-04-08T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'swiggy', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'XLS_202604_0088', 'credit', 19100, 9401862, 'card_refund', 'ZEPTO909NPLCYBS', NULL, 'CRV POS 514834******7103 ZEPTO909NPLCYBS', '2026-04-08T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP60994552599', 'credit', 649324, 10051186, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP60994552599', '2026-04-09T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000609982817828', 'credit', 842062, 10893248, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609982817828-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-09T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000609984165165', 'credit', 426769, 11320017, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-609984165165-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-09T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'XLS_202604_0092', 'credit', 200, 11320217, 'card_refund', 'GOOGLEWORKSP', NULL, 'CRV POS 514834******7103 GOOGLEWORKSP', '2026-04-09T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00925133108', 'debit', 2000000, 9320217, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00925133108-PETTY CASH', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00925133108-PETTY CASH', '2026-04-09T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 28, 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP61005274123', 'credit', 351900, 9672117, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61005274123', '2026-04-10T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610086451477', 'credit', 865499, 10537616, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610086451477-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-10T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000000009', 'debit', 9254400, 1283216, 'cheque', 'RK S-FREEZ WELL ENGINEER', NULL, 'CHQ PAID-CTS S5-RK S-FREEZ WELL ENGINEER', '2026-04-10T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610087852349', 'credit', 463922, 1747138, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610087852349-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-10T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00928036805', 'debit', 1000000, 747138, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00928036805-FOR VELU SALARY', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00928036805-FOR VELU SALARY', '2026-04-10T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 29, 'matched: Tanveer Ahmed Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP61015187280', 'credit', 411462, 1158600, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61015187280', '2026-04-11T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610190195615', 'credit', 970743, 2129343, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610190195615-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-11T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000001573524604', 'credit', 512257, 2641600, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SCAII2IZXBFWMH', 'FT- SCAII2IZXBFWMH - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-04-11T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610147648319', 'debit', 1900000, 741600, 'imps', 'MD KESMAT SK-PUNB-XXXXXXXXXX4120-SALARY', NULL, 'IMPS-610147648319-MD KESMAT SK-PUNB-XXXXXXXXXX4120-SALARY', '2026-04-11T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 15, 'matched: MD Kesmat SK Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610147649176', 'debit', 420000, 321600, 'imps', 'NOIM UDDIN-CBIN-XXXXXX0798-SALARY', NULL, 'IMPS-610147649176-NOIM  UDDIN-CBIN-XXXXXX0798-SALARY', '2026-04-11T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 21, 'matched: Noim Uddin Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP61024795165', 'credit', 529119, 850719, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61024795165', '2026-04-12T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000001573960081', 'credit', 1267404, 2118123, 'ft', 'RAZORPAY SOFTWARE PVT LTD', 'SCR4ROU1KHKP3F', 'FT- SCR4ROU1KHKP3F - 50200101395703-  RAZORPAY PAYMENTS PRIVATE LIMITED-ESCROW', '2026-04-12T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000571027', 'debit', 19400, 2098723, 'card', '571027 12APR26 10:01:47 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 571027 12APR26 10:01:47 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-12T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000500269', 'debit', 139598, 1959125, 'card_subscription', 'FIGMA', NULL, 'ME DC SI 514834XXXXXX7103 FIGMA', '2026-04-12T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000252091', 'debit', 11682, 1947443, 'card', '252091 12APR26 15:42:33 MUMBAI GODADDYLLCV2', NULL, 'POS 514834XXXXXX7103 252091 12APR26 15:42:33 MUMBAI GODADDYLLCV2', '2026-04-12T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610294967459', 'credit', 732610, 2680053, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610294967459-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-12T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000392318246', 'debit', 2250000, 430053, 'upi', 'AFEEFA IMPEX AGENCIES', '50KG', '50200116872951-TPT-50KG-AFEEFA IMPEX AGENCIES', '2026-04-12T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610296107123', 'credit', 369500, 799553, 'imps', 'PAYTM', NULL, 'IMPS-610296107123-PAYTMPAYMENTSSERVICESLTDPAYMENTAGGREGATORESCR-UTIB-XXXXXXXXXXX2533-IMPS', '2026-04-12T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00929647768', 'debit', 700000, 99553, 'neft', 'NAZEER NADEEM-NETBANK, MUM-HDFCH00929647768-NBXZE3VUUKW8CEG7', 'IDFB0080176', 'NEFT DR-IDFB0080176-NAZEER NADEEM-NETBANK, MUM-HDFCH00929647768-NBXZE3VUUKW8CEG7', '2026-04-12T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP61034637188', 'credit', 71500, 171053, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61034637188', '2026-04-13T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610397075703', 'credit', 1056761, 1227814, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610397075703-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-13T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000719162', 'debit', 78600, 1149214, 'card', '719162 13APR26 11:17:45 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 719162 13APR26 11:17:45 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-13T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00930618649', 'debit', 300000, 849214, 'neft', 'NAZEER NADEEM-NETBANK, MUM-HDFCH00930618649-NBXTBCJCK4CAVBCU', 'IDFB0080176', 'NEFT DR-IDFB0080176-NAZEER NADEEM-NETBANK, MUM-HDFCH00930618649-NBXTBCJCK4CAVBCU', '2026-04-13T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000542538', 'debit', 18500, 830714, 'card', '542538 13APR26 14:21:38 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 542538 13APR26 14:21:38 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-13T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610398514860', 'credit', 560491, 1391205, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610398514860-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-13T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00932232096', 'debit', 600000, 791205, 'neft', 'SHEIKH FAHEEMUL YOUSUF-NETBANK, MUM-HDFCH00932232096-300 OFFICE EXP', 'KKBK0008066', 'NEFT DR-KKBK0008066-SHEIKH FAHEEMUL YOUSUF-NETBANK, MUM-HDFCH00932232096-300 OFFICE EXP', '2026-04-13T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 25, 'matched: Sheikh Faheemul Staff Salary [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00932348803', 'debit', 775000, 16205, 'neft', 'JAY AND JAY DEHYDRO FOODS PRIVATE LIMITE-NETBANK, MUM-HDFCH00932348803-MILK POWD', 'UTIB0000194', 'NEFT DR-UTIB0000194-JAY AND JAY DEHYDRO FOODS PRIVATE LIMITE-NETBANK, MUM-HDFCH00932348803-MILK POWDER', '2026-04-13T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 11, 'matched: Jay And Jay Milk Powder Vendor [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000806335', 'debit', 16000, 205, 'card', '806335 13APR26 23:05:57 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 806335 13APR26 23:05:57 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-13T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP61044874977', 'credit', 147424, 147629, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61044874977', '2026-04-14T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610400892627', 'credit', 936096, 1083725, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610400892627-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-14T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000246441', 'debit', 27500, 1056225, 'card', '246441 14APR26 12:03:02 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 246441 14APR26 12:03:02 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-14T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00933024771', 'debit', 1000000, 56225, 'neft', 'MUDASSIR PASHA-NETBANK, MUM-HDFCH00933024771-CHARCOAL', 'KKBK0008061', 'NEFT DR-KKBK0008061-MUDASSIR  PASHA-NETBANK, MUM-HDFCH00933024771-CHARCOAL', '2026-04-14T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 18, 'matched: Mudassir Pasha Charcoal Supplier [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000752891', 'debit', 18000, 38225, 'card', '752891 14APR26 12:39:33 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 752891 14APR26 12:39:33 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-14T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESF361046381444', 'credit', 100, 38325, 'neft', 'EAZYDINER', 'YESB0000001', 'NEFT CR-YESB0000001-EAZYDINER PRIVATE LIMITED-HN HOTELS PRIVATE LIMITED-YESF361046381444', '2026-04-14T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'eazydiner', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610402115969', 'credit', 461159, 499484, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610402115969-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-14T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00933783229', 'debit', 400000, 99484, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00933783229-NBACGQYERSCTVAUB', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00933783229-NBACGQYERSCTVAUB', '2026-04-14T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 29, 'matched: Tanveer Ahmed Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP61054399960', 'credit', 458174, 557658, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61054399960', '2026-04-15T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610504290246', 'credit', 946903, 1504561, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610504290246-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-15T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000509724', 'debit', 494956, 1009605, 'card', '509724 15APR26 12:08:29 SAN FRANCISCO ANTHROPIC', NULL, 'POS 514834XXXXXX7103 509724 15APR26 12:08:29 SAN FRANCISCO ANTHROPIC', '2026-04-15T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000444448', 'debit', 200000, 809605, 'card', '444448 15APR26 13:33:57 MUMBAI GOOGLESERVIS', NULL, 'POS 514834XXXXXX7103 444448 15APR26 13:33:57 MUMBAI GOOGLESERVIS', '2026-04-15T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000403477', 'debit', 15900, 793705, 'card', '403477 15APR26 14:28:34 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 403477 15APR26 14:28:34 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-15T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000569865949323', 'credit', 400000, 1193705, 'upi', 'NAVEENKUMAR.CA0@YBL', 'NAVEENKUMAR.CA0@YBL', 'UPI-B NAVEEN KUMAR-NAVEENKUMAR.CA0@YBL-FDRL0001104-569865949323-PAYMENT FROM PHONE', '2026-04-15T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'CITIN26653030360', 'credit', 184781, 1378486, 'neft', 'ETERNAL LIMITED-HN HOTELS PRIVATE LIMITED-CITIN26653030360', 'CITI0000002', 'NEFT CR-CITI0000002-ETERNAL LIMITED-HN HOTELS PRIVATE LIMITED-CITIN26653030360', '2026-04-15T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610505677595', 'credit', 480147, 1858633, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610505677595-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-15T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000498430667', 'debit', 1800000, 58633, 'upi', 'SHARIFF DEPARTMENTAL STORES', 'NBEXFG2Q3CYGXQ5R', '50200055075789-TPT-NBEXFG2Q3CYGXQ5R-SHARIFF DEPARTMENTAL STORES', '2026-04-15T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 24, 'matched: Shariff Departmental Store [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP61064655755', 'credit', 333000, 391633, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61064655755', '2026-04-16T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610607912928', 'credit', 936247, 1327880, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610607912928-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-16T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000562075', 'debit', 10400, 1317480, 'card', '562075 16APR26 09:13:21 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 562075 16APR26 09:13:21 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-16T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000892221', 'debit', 9900, 1307580, 'card', '892221 16APR26 13:14:20 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 892221 16APR26 13:14:20 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-16T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000120621', 'debit', 496152, 811428, 'card', '120621 16APR26 14:23:47 SAN FRANCISCO ANTHROPIC', NULL, 'POS 514834XXXXXX7103 120621 16APR26 14:23:47 SAN FRANCISCO ANTHROPIC', '2026-04-16T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000197307', 'debit', 127448, 683980, 'card', '197307 16APR26 14:24:15 SAN FRANCISCO ANTHROPIC', NULL, 'POS 514834XXXXXX7103 197307 16APR26 14:24:15 SAN FRANCISCO ANTHROPIC', '2026-04-16T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000356458', 'debit', 300, 683680, 'card', '356458 16APR26 14:37:50 GURGAON FACEBOOK', NULL, 'POS 514834XXXXXX7103 356458 16APR26 14:37:50 GURGAON FACEBOOK', '2026-04-16T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000456079', 'debit', 12185, 671495, 'card', '456079 16APR26 14:38:35 GURGAON FACEBOOK', NULL, 'POS 514834XXXXXX7103 456079 16APR26 14:38:35 GURGAON FACEBOOK', '2026-04-16T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000556650', 'debit', 150000, 521495, 'card', '556650 16APR26 14:39:57 GURGAON WWW FACEBOOK COM ADSMA', NULL, 'POS 514834XXXXXX7103 556650 16APR26 14:39:57 GURGAON WWW FACEBOOK COM ADSMA', '2026-04-16T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610609188781', 'credit', 100, 521595, 'imps', 'BAVVALIDATION-UTIB-XXXXXXXXXXX9141-IMPS', NULL, 'IMPS-610609188781-BAVVALIDATION-UTIB-XXXXXXXXXXX9141-IMPS', '2026-04-16T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610609270092', 'credit', 467286, 988881, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610609270092-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-16T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'XLS_202604_0150', 'credit', 200, 989081, 'card_refund', 'GOOGLECLOUD', NULL, 'CRV POS 514834******7103 GOOGLECLOUD', '2026-04-16T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'XLS_202604_0151', 'credit', 200, 989281, 'card_refund', 'GOOGLECLOUD', NULL, 'CRV POS 514834******7103 GOOGLECLOUD', '2026-04-16T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'XLS_202604_0152', 'credit', 200, 989481, 'card_refund', 'GOOGLECLOUD', NULL, 'CRV POS 514834******7103 GOOGLECLOUD', '2026-04-16T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610649571691', 'debit', 900000, 89481, 'imps', 'TANVEER AHMED-SBIN-XXXXXXX8124-PETTY CASH', NULL, 'IMPS-610649571691-TANVEER AHMED-SBIN-XXXXXXX8124-PETTY CASH', '2026-04-16T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 28, 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP61074652252', 'credit', 532941, 622422, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61074652252', '2026-04-17T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610711533950', 'credit', 915374, 1537796, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610711533950-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-17T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000051672', 'debit', 10128, 1527668, 'card', '051672 17APR26 15:05:14 SINGAPORE ORACLE SINGAPORE', NULL, 'POS 514834XXXXXX7103 051672 17APR26 15:05:14 SINGAPORE ORACLE  SINGAPORE', '2026-04-17T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000051672', 'credit', 10128, 1537796, 'card', '051672 17APR26 15:09:02 SINGAPORE ORACLE SINGAPORE', NULL, 'POS 514834XXXXXX7103 051672 17APR26 15:09:02 SINGAPORE ORACLE  SINGAPORE', '2026-04-17T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000373303', 'debit', 44762, 1493034, 'card', '373303 17APR26 16:21:56 SAN FRANCISCO FLY.IO', NULL, 'POS 514834XXXXXX7103 373303 17APR26 16:21:56 SAN FRANCISCO FLY.IO', '2026-04-17T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000373303', 'credit', 44762, 1537796, 'card', '373303 17APR26 16:23:50 SAN FRANCISCO FLY.IO', NULL, 'POS 514834XXXXXX7103 373303 17APR26 16:23:50 SAN FRANCISCO FLY.IO', '2026-04-17T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610712921760', 'credit', 510682, 2048478, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610712921760-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-17T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00940379688', 'debit', 2000000, 48478, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00940379688-PETTY CASH', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00940379688-PETTY CASH', '2026-04-17T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 28, 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP61084660915', 'credit', 474163, 522641, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61084660915', '2026-04-18T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610815014467', 'credit', 1193535, 1716176, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610815014467-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-18T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00941389192', 'debit', 1500000, 216176, 'neft', 'B NAVEEN KUMAR-NETBANK, MUM-HDFCH00941389192-RECOVERY AMOUNT', 'FDRL0001104', 'NEFT DR-FDRL0001104-B NAVEEN KUMAR-NETBANK, MUM-HDFCH00941389192-RECOVERY AMOUNT', '2026-04-18T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 7, 'matched: B Naveen Kumar [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610816261851', 'credit', 642774, 858950, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610816261851-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-18T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'XLS_202604_0166', 'credit', 300, 859250, 'card_refund', 'FACEBOOK', NULL, 'CRV POS 514834******7103 FACEBOOK', '2026-04-18T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000119972111086', 'credit', 444000, 1303250, 'upi', 'PAYTM', 'POWERACCESS.PPSL2533@AXISBANK', 'UPI-PAYTM PAYMENTS SERVI-POWERACCESS.PPSL2533@AXISBANK-UTIB0000022-119972111086-AWSPG2026041800010', '2026-04-18T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610816654443', 'credit', 375334, 1678584, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610816654443-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-18T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610850329279', 'debit', 1600000, 78584, 'imps', 'AJIM MOHAMMAD-UTIB-XXXXXXXXXXX1634-SALARY', NULL, 'IMPS-610850329279-AJIM MOHAMMAD-UTIB-XXXXXXXXXXX1634-SALARY', '2026-04-18T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 4, 'matched: Ajim Mohammad Head Cook Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'AXNPM10948864441', 'credit', 270800, 349384, 'neft', 'PAYTM', 'UTIB0000022', 'NEFT CR-UTIB0000022-PAYTM PAYMENTS SERVICES LTD-PAYMENT AGGREGATOR ES-HN HOTELS PRIVATE LIMITED-AXNPM10948864441', '2026-04-19T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610918352370', 'credit', 1109175, 1458559, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610918352370-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-19T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000202934', 'debit', 16000, 1442559, 'card', '202934 19APR26 13:10:13 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 202934 19APR26 13:10:13 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-19T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610950550798', 'debit', 1200000, 242559, 'imps', 'MUJIB-CNRB-XXXXXXXX3457-DAILY SALARY', NULL, 'IMPS-610950550798-MUJIB-CNRB-XXXXXXXX3457-DAILY SALARY', '2026-04-19T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 19, 'matched: Mujib Tea Master Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610919375874', 'credit', 600864, 843423, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-610919375874-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-19T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000610950622378', 'debit', 800000, 43423, 'imps', 'TANVEER AHMED-SBIN-XXXXXXX8124-TABARAK SALARY', NULL, 'IMPS-610950622378-TANVEER AHMED-SBIN-XXXXXXX8124-TABARAK SALARY', '2026-04-19T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 29, 'matched: Tanveer Ahmed Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000504413', 'debit', 27500, 15923, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 504413 20APR26 00:28:37 NOIDA PTM*SWIGGY', '2026-04-20T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'swiggy', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP61104781065', 'credit', 833165, 849088, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61104781065', '2026-04-20T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611021308672', 'credit', 1149328, 1998416, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-611021308672-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-20T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000666032', 'debit', 22100, 1976316, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 666032 20APR26 12:52:46 GURGAON PAY*SWIGGY INSTAMART', '2026-04-20T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'swiggy', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611094582701', 'credit', 100, 1976416, 'imps', 'API BANKING EB-NESF-XXXXXXXXXXXXXXXX6172-PAYOUT', NULL, 'IMPS-611094582701-API BANKING EB-NESF-XXXXXXXXXXXXXXXX6172-PAYOUT', '2026-04-20T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611022597195', 'credit', 552094, 2528510, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-611022597195-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-20T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611051007617', 'debit', 1200000, 1328510, 'imps', 'MUJIB-CNRB-XXXXXXXX3457-DAILY SALARY', NULL, 'IMPS-611051007617-MUJIB-CNRB-XXXXXXXX3457-DAILY SALARY', '2026-04-20T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 19, 'matched: Mujib Tea Master Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611051027507', 'debit', 1200000, 128510, 'imps', 'MOHAMMED ISMAIL-JAKA-XXXXXXXXXXXX4806-2 WEEKS SALARY', NULL, 'IMPS-611051027507-MOHAMMED ISMAIL-JAKA-XXXXXXXXXXXX4806-2 WEEKS SALARY', '2026-04-20T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 17, 'matched: Mohammed Ismail Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP61114514085', 'credit', 941930, 1070440, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61114514085', '2026-04-21T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611124631529', 'credit', 819071, 1889511, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-611124631529-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-21T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611151324178', 'debit', 920000, 969511, 'imps', 'TANVEER AHMED-SBIN-XXXXXXX8124-HAMZA SALARY', NULL, 'IMPS-611151324178-TANVEER AHMED-SBIN-XXXXXXX8124-HAMZA SALARY', '2026-04-21T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 29, 'matched: Tanveer Ahmed Salary AC [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611125840888', 'credit', 428594, 1398105, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-611125840888-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-21T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESF361116154870', 'credit', 68994, 1467099, 'neft', 'EAZYDINER', 'YESB0000001', 'NEFT CR-YESB0000001-EAZYDINER PRIVATE LIMITED-HN HOTELS PRIVATE LIMITED-YESF361116154870', '2026-04-21T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'eazydiner', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00947958650', 'debit', 1400000, 67099, 'neft', 'TANVEER AHMED-NETBANK, MUM-HDFCH00947958650-PETTY CASH', 'SBIN0062221', 'NEFT DR-SBIN0062221-TANVEER AHMED-NETBANK, MUM-HDFCH00947958650-PETTY CASH', '2026-04-21T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 28, 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000990762', 'debit', 9900, 57199, 'card', '990762 22APR26 01:56:08 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 990762 22APR26 01:56:08 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-22T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP61124339323', 'credit', 590200, 647399, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61124339323', '2026-04-22T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611227870539', 'credit', 780647, 1428046, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-611227870539-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-22T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'CITIN26655781913', 'credit', 682996, 2111042, 'neft', 'ETERNAL LIMITED-HN HOTELS PRIVATE LIMITED-CITIN26655781913', 'CITI0000002', 'NEFT CR-CITI0000002-ETERNAL LIMITED-HN HOTELS PRIVATE LIMITED-CITIN26655781913', '2026-04-22T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'CITIN26655779686', 'credit', 79745, 2190787, 'neft', 'ETERNAL LIMITED-HN HOTELS PRIVATE LIMITED-CITIN26655779686', 'CITI0000002', 'NEFT CR-CITI0000002-ETERNAL LIMITED-HN HOTELS PRIVATE LIMITED-CITIN26655779686', '2026-04-22T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611229093078', 'credit', 433749, 2624536, 'imps', 'RAZORPAY SOFTWARE PVT LTD', NULL, 'IMPS-611229093078-RAZORPAYPAYMENTSPVTLTDPAYMENTAGGREGATORESCROW-UTIB-XXXXXXXXXXX6002-RAZORPAYSOFTWAREPRIVATELIMI', '2026-04-22T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000647810', 'debit', 30100, 2594436, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 647810 23APR26 01:55:16 GURGAON WWW SWIGGY COM', '2026-04-23T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'swiggy', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP61134341361', 'credit', 419925, 3014361, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61134341361', '2026-04-23T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000454482', 'debit', 21300, 2993061, 'card', '454482 23APR26 05:59:07 GURGAON PAY*ZEPTO', NULL, 'POS 514834XXXXXX7103 454482 23APR26 05:59:07 GURGAON PAY*ZEPTO', '2026-04-23T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000345050', 'debit', 91200, 2901861, 'card', '345050 23APR26 09:37:34 BANGALORE FLIPKART INTERNET PVT', NULL, 'POS 514834XXXXXX7103 345050 23APR26 09:37:34 BANGALORE FLIPKART INTERNET PVT', '2026-04-23T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'AXISCN1322238660', 'credit', 88202, 2990063, 'neft', 'RAZORPAY SOFTWARE PVT LTD', 'UTIB0001506', 'NEFT CR-UTIB0001506-RAZORPAY PAYMENTS PVT LTD PAYMENT AGGREGATOR ESCR-HN HOTELS PRIVATE LIMITED-AXISCN1322238660', '2026-04-23T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'AXISCN1322475661', 'credit', 143357, 3133420, 'neft', 'RAZORPAY SOFTWARE PVT LTD', 'UTIB0001506', 'NEFT CR-UTIB0001506-RAZORPAY PAYMENTS PVT LTD PAYMENT AGGREGATOR ESCR-HN HOTELS PRIVATE LIMITED-AXISCN1322475661', '2026-04-23T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611352121743', 'debit', 1500000, 1633420, 'imps', 'B NAVEEN KUMAR-FDRL-XXXXXXXXXX1370-NAVEEN BAL RECOVERY', NULL, 'IMPS-611352121743-B NAVEEN KUMAR-FDRL-XXXXXXXXXX1370-NAVEEN BAL RECOVERY', '2026-04-23T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 7, 'matched: B Naveen Kumar [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611352122667', 'debit', 1500000, 133420, 'imps', 'TANVEER AHMED-SBIN-XXXXXXX8124-PETTY CASH', NULL, 'IMPS-611352122667-TANVEER AHMED-SBIN-XXXXXXX8124-PETTY CASH', '2026-04-23T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 28, 'matched: Tanveer Ahmed Petty Cash Account [petty_cash]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP61144524648', 'credit', 582000, 715420, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61144524648', '2026-04-24T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'AXISCN1323020587', 'credit', 1253771, 1969191, 'neft', 'RAZORPAY SOFTWARE PVT LTD', 'UTIB0001506', 'NEFT CR-UTIB0001506-RAZORPAY PAYMENTS PVT LTD PAYMENT AGGREGATOR ESCR-HN HOTELS PRIVATE LIMITED-AXISCN1323020587', '2026-04-24T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'AXISCN1323193366', 'credit', 1206599, 3175790, 'neft', 'RAZORPAY SOFTWARE PVT LTD', 'UTIB0001506', 'NEFT CR-UTIB0001506-RAZORPAY PAYMENTS PVT LTD PAYMENT AGGREGATOR ESCR-HN HOTELS PRIVATE LIMITED-AXISCN1323193366', '2026-04-24T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000370495436', 'debit', 2250000, 925790, 'upi', 'AFEEFA IMPEX AGENCIES', 'FOR 50KG TEA POWDER', '50200116872951-TPT-FOR 50KG TEA POWDER-AFEEFA IMPEX AGENCIES', '2026-04-24T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'AXISCN1323450726', 'credit', 267103, 1192893, 'neft', 'RAZORPAY SOFTWARE PVT LTD', 'UTIB0001506', 'NEFT CR-UTIB0001506-RAZORPAY PAYMENTS PVT LTD PAYMENT AGGREGATOR ESCR-HN HOTELS PRIVATE LIMITED-AXISCN1323450726', '2026-04-24T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP61154998610', 'credit', 571800, 1764693, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61154998610', '2026-04-25T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000426479', 'debit', 76012, 1688681, 'card', '426479 25APR26 14:39:19 MUMBAI MYJIO', NULL, 'POS 514834XXXXXX7103 426479 25APR26 14:39:19 MUMBAI MYJIO', '2026-04-25T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP61163961101', 'credit', 688189, 2376870, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61163961101', '2026-04-26T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000251427123', 'debit', 1500000, 876870, 'upi', 'SHARIFF DEPARTMENTAL STORES', 'HDFCCCFFAAD0E71E', '50200055075789-TPT-HDFCCCFFAAD0E71E-SHARIFF DEPARTMENTAL STORES', '2026-04-26T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 24, 'matched: Shariff Departmental Store [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00955450668', 'debit', 700000, 176870, 'neft', 'PRAGALATHAN M-NETBANK, MUM-HDFCH00955450668-HDFCB577EE104715', 'SBIN0012768', 'NEFT DR-SBIN0012768-PRAGALATHAN M-NETBANK, MUM-HDFCH00955450668-HDFCB577EE104715', '2026-04-26T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP61174417604', 'credit', 1065605, 1242475, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61174417604', '2026-04-27T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'EPR2711671652054', 'debit', 5766, 1236709, 'charges', 'INTL POS MARKUP FEE', NULL, 'DC INTL POS TXN MARKUP+ST 120426-EPR2711671652054', '2026-04-27T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611746004709', 'debit', 100, 1236609, 'upi', 'JUVAIRIYAHANEEF@OKAXIS', 'JUVAIRIYAHANEEF@OKAXIS', 'UPI-JUVIRIA HANEEF-JUVAIRIYAHANEEF@OKAXIS-HDFC0006249-611746004709-UPI SEND MONEY', '2026-04-27T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'AXISCN1325385193', 'credit', 4460096, 5696705, 'neft', 'RAZORPAY SOFTWARE PVT LTD', 'UTIB0001506', 'NEFT CR-UTIB0001506-RAZORPAY PAYMENTS PVT LTD PAYMENT AGGREGATOR ESCR-HN HOTELS PRIVATE LIMITED-AXISCN1325385193', '2026-04-27T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00955881319', 'debit', 1200000, 4496705, 'neft', 'AJIM MOHAMMAD-NETBANK, MUM-HDFCH00955881319-HDFC41C18B10FA96', 'UTIB0002321', 'NEFT DR-UTIB0002321-AJIM MOHAMMAD-NETBANK, MUM-HDFCH00955881319-HDFC41C18B10FA96', '2026-04-27T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'AXISCN1325597933', 'credit', 111464, 4608169, 'neft', 'RAZORPAY SOFTWARE PVT LTD', 'UTIB0001506', 'NEFT CR-UTIB0001506-RAZORPAY PAYMENTS PVT LTD PAYMENT AGGREGATOR ESCR-HN HOTELS PRIVATE LIMITED-AXISCN1325597933', '2026-04-27T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'AXISCN1325878192', 'credit', 142844, 4751013, 'neft', 'RAZORPAY SOFTWARE PVT LTD', 'UTIB0001506', 'NEFT CR-UTIB0001506-RAZORPAY PAYMENTS PVT LTD PAYMENT AGGREGATOR ESCR-HN HOTELS PRIVATE LIMITED-AXISCN1325878192', '2026-04-27T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611751838387', 'debit', 2500, 4748513, 'upi', 'PAYTM', 'PAYTM.S1X89KF@PTY', 'UPI-AMIRTHA RATHNAGIRI 6-PAYTM.S1X89KF@PTY-YESB0MCHUPI-611751838387-UPI SEND MONEY', '2026-04-27T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00957781114', 'debit', 1500000, 3248513, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00957781114-HDFCCAEDF59724DD', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00957781114-HDFCCAEDF59724DD', '2026-04-27T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP61183615669', 'credit', 128067, 3376580, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61183615669', '2026-04-28T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'AXISCN1326547716', 'credit', 1082556, 4459136, 'neft', 'RAZORPAY SOFTWARE PVT LTD', 'UTIB0001506', 'NEFT CR-UTIB0001506-RAZORPAY PAYMENTS PVT LTD PAYMENT AGGREGATOR ESCR-HN HOTELS PRIVATE LIMITED-AXISCN1326547716', '2026-04-28T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000018305', 'debit', 86700, 4372436, 'card', 'SWIGGY', NULL, 'POS 514834XXXXXX7103 018305 28APR26 12:13:33 GURGAON WWW SWIGGY COM', '2026-04-28T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'swiggy', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611858573857', 'debit', 2500, 4369936, 'upi', 'PAYTM', 'PAYTM.S1X89KF@PTY', 'UPI-AMIRTHA RATHNAGIRI 6-PAYTM.S1X89KF@PTY-YESB0MCHUPI-611858573857-UPI SEND MONEY', '2026-04-28T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'EPR2711876375531', 'debit', 2950, 4366986, 'card', '14/04/26 CARDEND 7103-EPR2711876375531', NULL, 'POS DECCHG 14/04/26 CARDEND 7103-EPR2711876375531', '2026-04-28T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000012360', 'debit', 29900, 4337086, 'card_subscription', 'JIOHOTSTAR', NULL, 'ME DC SI 514834XXXXXX7103 JIOHOTSTAR', '2026-04-28T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00959001759', 'debit', 550000, 3787086, 'neft', 'PRAGALATHAN M-NETBANK, MUM-HDFCH00959001759-HDFC6C16F3325C69', 'SBIN0012768', 'NEFT DR-SBIN0012768-PRAGALATHAN M-NETBANK, MUM-HDFCH00959001759-HDFC6C16F3325C69', '2026-04-28T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611859844986', 'debit', 300000, 3487086, 'upi', 'JAKA0FRAZER', NULL, 'UPI-XXXXXXXXXXXX4806-JAKA0FRAZER-611859844986-UPI SEND MONEY', '2026-04-28T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'AXISCN1326957920', 'credit', 228238, 3715324, 'neft', 'RAZORPAY SOFTWARE PVT LTD', 'UTIB0001506', 'NEFT CR-UTIB0001506-RAZORPAY PAYMENTS PVT LTD PAYMENT AGGREGATOR ESCR-HN HOTELS PRIVATE LIMITED-AXISCN1326957920', '2026-04-28T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611860856101', 'debit', 55500, 3659824, 'upi', '9940911254@OKBIZAXIS', '9940911254@OKBIZAXIS', 'UPI-TAK INTERESTING FOOD-9940911254@OKBIZAXIS-UTIB0000553-611860856101-UPI SEND MONEY', '2026-04-28T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611860989142', 'debit', 1300, 3658524, 'upi', 'Q753435794@YBL', 'Q753435794@YBL', 'UPI-MR  MURUGAN  D-Q753435794@YBL-YESB0YBLUPI-611860989142-UPI SEND MONEY', '2026-04-28T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611863734698', 'debit', 16200, 3642324, 'upi', 'PAYTM', 'PAYTMQR5C3LPG@PTYS', 'UPI-SRI VENKATESHWARA PU-PAYTMQR5C3LPG@PTYS-YESB0PTMUPI-611863734698-UPI SEND MONEY', '2026-04-28T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611863750335', 'debit', 2500, 3639824, 'upi', 'PAYTM', 'PAYTM.S19RSH3@PTY', 'UPI-ANNADURAI MUNUSAMY-PAYTM.S19RSH3@PTY-YESB0MCHUPI-611863750335-UPI SEND MONEY', '2026-04-28T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000611864953019', 'debit', 17400, 3622424, 'upi', 'BHARATPE.9B0E0N0P3B054919@UNITYPE', 'BHARATPE.9B0E0N0P3B054919@UNITYPE', 'UPI-NAVEEN S-BHARATPE.9B0E0N0P3B054919@UNITYPE-UNBA000BHPE-611864953019-PAY TO BHARATPE ME', '2026-04-28T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00959769337', 'debit', 300000, 3322424, 'neft', 'SK MUNTAZ-NETBANK, MUM-HDFCH00959769337-HDFC16BDE9887490', 'PUNB0108110', 'NEFT DR-PUNB0108110-SK MUNTAZ-NETBANK, MUM-HDFCH00959769337-HDFC16BDE9887490', '2026-04-29T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP61194032029', 'credit', 496218, 3818642, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61194032029', '2026-04-29T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'EPR2711876952416', 'debit', 20442, 3798200, 'charges', 'INTL POS MARKUP FEE', NULL, 'DC INTL POS TXN MARKUP+ST 150426-EPR2711876952416', '2026-04-29T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'EPR2711978316309', 'debit', 2950, 3795250, 'card', '16/04/26 CARDEND 7103-EPR2711978316309', NULL, 'POS DECCHG 16/04/26 CARDEND 7103-EPR2711978316309', '2026-04-29T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'EPR2711978316336', 'debit', 20492, 3774758, 'charges', 'INTL POS MARKUP FEE', NULL, 'DC INTL POS TXN MARKUP+ST 160426-EPR2711978316336', '2026-04-29T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'EPR2711978316329', 'debit', 2950, 3771808, 'card', '16/04/26 CARDEND 7103-EPR2711978316329', NULL, 'POS DECCHG 16/04/26 CARDEND 7103-EPR2711978316329', '2026-04-29T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'EPR2711978316347', 'debit', 5263, 3766545, 'charges', 'INTL POS MARKUP FEE', NULL, 'DC INTL POS TXN MARKUP+ST 160426-EPR2711978316347', '2026-04-29T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'EPR2711978316322', 'debit', 2950, 3763595, 'card', '16/04/26 CARDEND 7103-EPR2711978316322', NULL, 'POS DECCHG 16/04/26 CARDEND 7103-EPR2711978316322', '2026-04-29T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'AXISCN1327643005', 'credit', 1169437, 4933032, 'neft', 'RAZORPAY SOFTWARE PVT LTD', 'UTIB0001506', 'NEFT CR-UTIB0001506-RAZORPAY PAYMENTS PVT LTD PAYMENT AGGREGATOR ESCR-HN HOTELS PRIVATE LIMITED-AXISCN1327643005', '2026-04-29T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'AXISCN1328009676', 'credit', 305974, 5239006, 'neft', 'BUNDL TECHNOLOGIES PRIVATE LIMITED-HN HOTELS PRIVATE LIMITED-AXISCN1328009676', 'UTIB0000052', 'NEFT CR-UTIB0000052-BUNDL TECHNOLOGIES PRIVATE LIMITED-HN HOTELS PRIVATE LIMITED-AXISCN1328009676', '2026-04-29T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'AXISCN1328225253', 'credit', 150043, 5389049, 'neft', 'RAZORPAY SOFTWARE PVT LTD', 'UTIB0001506', 'NEFT CR-UTIB0001506-RAZORPAY PAYMENTS PVT LTD PAYMENT AGGREGATOR ESCR-HN HOTELS PRIVATE LIMITED-AXISCN1328225253', '2026-04-29T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'AXISCN1328252167', 'credit', 11793, 5400842, 'neft', 'BUNDL TECHNOLOGIES PRIVATE LIMITED-HN HOTELS PRIVATE LIMITED-AXISCN1328252167', 'UTIB0000052', 'NEFT CR-UTIB0000052-BUNDL TECHNOLOGIES PRIVATE LIMITED-HN HOTELS PRIVATE LIMITED-AXISCN1328252167', '2026-04-29T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'CITIN26659802811', 'credit', 28021, 5428863, 'neft', 'ETERNAL LIMITED-HN HOTELS PRIVATE LIMITED-CITIN26659802811', 'CITI0000002', 'NEFT CR-CITI0000002-ETERNAL LIMITED-HN HOTELS PRIVATE LIMITED-CITIN26659802811', '2026-04-29T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'CITIN26659808422', 'credit', 971657, 6400520, 'neft', 'ETERNAL LIMITED-HN HOTELS PRIVATE LIMITED-CITIN26659808422', 'CITI0000002', 'NEFT CR-CITI0000002-ETERNAL LIMITED-HN HOTELS PRIVATE LIMITED-CITIN26659808422', '2026-04-29T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00961875621', 'debit', 800000, 5600520, 'neft', 'PRAGALATHAN M-NETBANK, MUM-HDFCH00961875621-NBO3QXQINK8OPIWN', 'SBIN0012768', 'NEFT DR-SBIN0012768-PRAGALATHAN M-NETBANK, MUM-HDFCH00961875621-NBO3QXQINK8OPIWN', '2026-04-29T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00962156389', 'debit', 800000, 4800520, 'neft', 'AM RUBA BHARAT GAS-NETBANK, MUM-HDFCH00962156389-NBQWZHWH01UGQPNH', 'SBIN0001731', 'NEFT DR-SBIN0001731-AM RUBA BHARAT GAS-NETBANK, MUM-HDFCH00962156389-NBQWZHWH01UGQPNH', '2026-04-29T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 5, 'matched: AM Ruba Bharat Gas Vendor [vendor]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'YESAP61204395634', 'credit', 704449, 5504969, 'neft', 'PAYTM', 'YESB0000001', 'NEFT CR-YESB0000001-PAYTM PAYMENTS SERVICES LIMITED PA -HN HOTELS PRIVATE LIMITED-YESAP61204395634', '2026-04-30T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'paytm', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'AXISCN1328939327', 'credit', 925526, 6430495, 'neft', 'RAZORPAY SOFTWARE PVT LTD', 'UTIB0001506', 'NEFT CR-UTIB0001506-RAZORPAY PAYMENTS PVT LTD PAYMENT AGGREGATOR ESCR-HN HOTELS PRIVATE LIMITED-AXISCN1328939327', '2026-04-30T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00963241094', 'debit', 1500000, 4930495, 'neft', 'MUJIB-NETBANK, MUM-HDFCH00963241094-HDFC234E3ACA29C1', 'CNRB0001156', 'NEFT DR-CNRB0001156-MUJIB-NETBANK, MUM-HDFCH00963241094-HDFC234E3ACA29C1', '2026-04-30T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'AXISCN1329340451', 'credit', 219343, 5149838, 'neft', 'RAZORPAY SOFTWARE PVT LTD', 'UTIB0001506', 'NEFT CR-UTIB0001506-RAZORPAY PAYMENTS PVT LTD PAYMENT AGGREGATOR ESCR-HN HOTELS PRIVATE LIMITED-AXISCN1329340451', '2026-04-30T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', 'razorpay', NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00966276849', 'debit', 800000, 4349838, 'neft', 'SHEIKH FAHEEMUL YOUSUF-NETBANK, MUM-HDFCH00966276849-HDFC9FD137AE1F87', 'KKBK0008066', 'NEFT DR-KKBK0008066-SHEIKH FAHEEMUL YOUSUF-NETBANK, MUM-HDFCH00966276849-HDFC9FD137AE1F87', '2026-04-30T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, 25, 'matched: Sheikh Faheemul Staff Salary [salary]');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', '0000000000098264', 'debit', 48000, 4301838, 'card', '098264 30APR26 21:02:28 BANGALORE ZEPTO MARKETPLACE PRIV', NULL, 'POS 514834XXXXXX7103 098264 30APR26 21:02:28 BANGALORE ZEPTO MARKETPLACE PRIV', '2026-04-30T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');
INSERT OR IGNORE INTO money_events
  (source, instrument, source_ref, direction, amount_paise,
   balance_paise_after, channel, counterparty, counterparty_ref,
   narration, txn_at, received_at, parse_status,
   settlement_platform, matched_payee_id, notes)
VALUES ('hdfc', 'hdfc_ca_4680', 'HDFCH00966426795', 'debit', 256000, 4045838, 'neft', 'NAZEER NADEEM-NETBANK, MUM-HDFCH00966426795-NBKYCQAR3GF8DFYO', 'IDFB0080176', 'NEFT DR-IDFB0080176-NAZEER NADEEM-NETBANK, MUM-HDFCH00966426795-NBKYCQAR3GF8DFYO', '2026-04-30T00:00:00+05:30', '2026-05-01T11:02:10.219117+05:30', 'parsed', NULL, NULL, '');

UPDATE money_source_health SET last_event_at='2026-05-01T11:02:10.219117+05:30', last_checked_at=CURRENT_TIMESTAMP, status='healthy' WHERE source='hdfc' AND instrument='hdfc_ca_4680';
