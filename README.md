# HN Hotels Private Limited - Corporate Website

## Official Company Website for hnhotels.in

### Legal Entity Information
- **Company Name:** HN Hotels Private Limited
- **CIN:** U55101KA2023PTC182051
- **Date of Incorporation:** 11th December 2023
- **Registered Address:** #22, 3rd Floor, H.K.P. Road, Shivajinagar, Bangalore - 560051, Karnataka

---

## 🚀 COMPLETE SETUP GUIDE

### Step 1: Create GitHub Repository

1. **Go to GitHub.com** and sign in
2. Click **"New Repository"** (+ icon → New repository)
3. Fill in:
   - **Repository name:** `hnhotels-website`
   - **Description:** `Official website for HN Hotels Private Limited`
   - **Visibility:** Public (required for free Cloudflare Pages)
   - ✅ Check "Add a README file"
4. Click **"Create repository"**

### Step 2: Connect Antigravity to GitHub

1. **In Antigravity**, open the project folder
2. Go to **Settings** → **Git**
3. Click **"Connect to GitHub"**
4. Authorize Antigravity to access your GitHub account
5. Select the repository: `hnhotels-website`
6. Set branch: `main`
7. Click **"Connect"**

### Step 3: Push Code from Antigravity

In Antigravity terminal, run these commands:

```bash
# Initialize git (if not already done)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit: HN Hotels corporate website"

# Set remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/hnhotels-website.git

# Push to GitHub
git branch -M main
git push -u origin main
```

**Or use Antigravity's GUI:**
1. Click the **Source Control** icon (branch icon)
2. Stage all changes
3. Enter commit message: `Initial commit: HN Hotels corporate website`
4. Click **Commit**
5. Click **Push**

### Step 4: Set Up Cloudflare Pages

1. **Go to:** https://dash.cloudflare.com/
2. Sign in to your Cloudflare account
3. In the sidebar, click **"Workers & Pages"**
4. Click **"Create"** → **"Pages"** → **"Connect to Git"**
5. Select **GitHub** and authorize if needed
6. Select repository: `hnhotels-website`
7. Configure build settings:
   - **Production branch:** `main`
   - **Build command:** (leave empty)
   - **Build output directory:** `/` (root)
8. Click **"Save and Deploy"**
9. Wait for deployment (usually 1-2 minutes)
10. You'll get a URL like: `hnhotels-website.pages.dev`

### Step 5: Point GoDaddy Domain to Cloudflare

#### Option A: Use Cloudflare Nameservers (Recommended)

1. **In Cloudflare Dashboard:**
   - Go to **Websites** → **Add a Site**
   - Enter: `hnhotels.in`
   - Select **Free** plan
   - Cloudflare will scan DNS records
   - Note the two nameservers provided (e.g., `anna.ns.cloudflare.com`, `bob.ns.cloudflare.com`)

2. **In GoDaddy:**
   - Log in to GoDaddy
   - Go to **My Products** → **Domains**
   - Click on `hnhotels.in` → **Manage DNS**
   - Scroll down to **Nameservers**
   - Click **Change** → **Enter my own nameservers**
   - Enter the Cloudflare nameservers:
     ```
     anna.ns.cloudflare.com
     bob.ns.cloudflare.com
     ```
   - Click **Save**

3. **Wait for DNS propagation** (can take up to 24-48 hours, usually 1-2 hours)

4. **Back in Cloudflare:**
   - Once nameservers are verified, go to **Workers & Pages**
   - Select your `hnhotels-website` project
   - Go to **Custom domains**
   - Click **Set up a custom domain**
   - Enter: `hnhotels.in`
   - Also add: `www.hnhotels.in`
   - Cloudflare will automatically configure DNS records

#### Option B: Keep GoDaddy Nameservers (Use CNAME)

If you prefer to keep GoDaddy nameservers:

1. **In GoDaddy DNS settings**, add:
   
   | Type | Name | Value | TTL |
   |------|------|-------|-----|
   | CNAME | @ | hnhotels-website.pages.dev | 600 |
   | CNAME | www | hnhotels-website.pages.dev | 600 |

2. **In Cloudflare Pages:**
   - Go to your project → **Custom domains**
   - Add `hnhotels.in` and `www.hnhotels.in`
   - Follow verification steps

### Step 6: Verify Deployment

1. Visit https://hnhotels.in
2. Check that SSL certificate is active (padlock icon)
3. Test all pages and links
4. Verify on mobile devices

---

## 📁 File Structure

```
hnhotels-website/
├── index.html              # Main website (single page)
├── assets/
│   ├── Hamza_Hotel_Logo.png
│   ├── Hamza_Express_Logo.jpg
│   ├── Nawabi_Chai_House_Logo.png
│   └── favicon.png
└── README.md               # This file
```

---

## ✅ Legal Information Displayed

The website accurately displays the following verified information:

| Field | Value |
|-------|-------|
| Company Name | HN Hotels Private Limited |
| CIN | U55101KA2023PTC182051 |
| PAN | AAHCH1024M |
| TAN | BLRH15862A |
| UDYAM | UDYAM-KR-03-0606827 |
| Date of Incorporation | 11th December 2023 |
| Enterprise Type | Micro Enterprise |
| NIC Code | 56101 (Restaurants) |
| Bank | Federal Bank |
| Account | 11040200034570 |
| IFSC | FDRL0001104 |

---

## 🔧 Antigravity Quick Commands

```bash
# Preview locally
npx serve .

# Check git status
git status

# Push changes
git add .
git commit -m "Update website"
git push

# Pull latest
git pull origin main
```

---

## 📞 Support

For website issues, contact: nihafwork@gmail.com

---

© 2024 HN Hotels Private Limited. All rights reserved.
