const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Database setup
const db = new sqlite3.Database('./database.db');

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    video_url TEXT NOT NULL,
    video_type TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
});

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'video-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed!'), false);
    }
  },
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit
  }
});

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Routes

// Register endpoint
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;

  // Validation
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.run(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [name, email, hashedPassword],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email already exists' });
          }
          return res.status(500).json({ error: 'Failed to create account' });
        }
        
        const token = jwt.sign(
          { id: this.lastID, email },
          process.env.JWT_SECRET || 'your-secret-key',
          { expiresIn: '7d' }
        );
        
        res.json({ 
          token, 
          user: { 
            id: this.lastID, 
            name, 
            email,
            created_at: new Date().toISOString()
          } 
        });
      }
    );
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login endpoint
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  // Validation
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) {
      console.error('Login database error:', err);
      return res.status(500).json({ error: 'Server error' });
    }

    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { 
        id: user.id, 
        name: user.name, 
        email: user.email,
        created_at: user.created_at
      }
    });
  });
});

// Update profile endpoint
app.put('/api/profile', authenticateToken, (req, res) => {
  const { name, email } = req.body;
  const userId = req.user.id;

  // Validation
  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  if (name.length < 2) {
    return res.status(400).json({ error: 'Name must be at least 2 characters long' });
  }

  db.run(
    'UPDATE users SET name = ?, email = ? WHERE id = ?',
    [name, email, userId],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'Email already exists' });
        }
        console.error('Profile update error:', err);
        return res.status(500).json({ error: 'Failed to update profile' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Get updated user data
      db.get('SELECT id, name, email, created_at FROM users WHERE id = ?', [userId], (err, user) => {
        if (err) {
          console.error('Error fetching updated user:', err);
          return res.status(500).json({ error: 'Failed to fetch updated profile' });
        }

        res.json({ 
          message: 'Profile updated successfully',
          user: user
        });
      });
    }
  );
});

// Delete account endpoint
app.delete('/api/account', authenticateToken, (req, res) => {
  const userId = req.user.id;

  console.log(`Starting account deletion for user ID: ${userId}`);

  // Use transactions for data consistency
  db.serialize(() => {
    // Begin transaction
    db.run('BEGIN TRANSACTION');

    // First, get all user's videos to delete files
    db.all('SELECT * FROM videos WHERE user_id = ?', [userId], (err, videos) => {
      if (err) {
        console.error('Error fetching user videos for deletion:', err);
        db.run('ROLLBACK');
        return res.status(500).json({ error: 'Failed to delete account' });
      }

      console.log(`Found ${videos.length} videos to delete for user ${userId}`);

      // Delete video files from filesystem
      let filesDeleted = 0;
      videos.forEach(video => {
        if (video.video_type === 'file' && video.video_url) {
          const filePath = path.join(__dirname, video.video_url);
          if (fs.existsSync(filePath)) {
            try {
              fs.unlinkSync(filePath);
              filesDeleted++;
              console.log(`Deleted video file: ${filePath}`);
            } catch (fileError) {
              console.error(`Error deleting file ${filePath}:`, fileError);
            }
          }
        }
      });

      console.log(`Deleted ${filesDeleted} video files`);

      // Delete user's videos from database
      db.run('DELETE FROM videos WHERE user_id = ?', [userId], function(err) {
        if (err) {
          console.error('Error deleting user videos from database:', err);
          db.run('ROLLBACK');
          return res.status(500).json({ error: 'Failed to delete account data' });
        }

        console.log(`Deleted ${this.changes} video records from database`);

        // Finally, delete the user account
        db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
          if (err) {
            console.error('Error deleting user account:', err);
            db.run('ROLLBACK');
            return res.status(500).json({ error: 'Failed to delete account' });
          }

          if (this.changes === 0) {
            console.error('User not found for deletion');
            db.run('ROLLBACK');
            return res.status(404).json({ error: 'User not found' });
          }

          // Commit transaction
          db.run('COMMIT', (err) => {
            if (err) {
              console.error('Error committing transaction:', err);
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'Failed to complete account deletion' });
            }

            console.log(`Successfully deleted account for user ID: ${userId}`);
            res.json({ 
              message: 'Account and all associated data deleted successfully',
              details: {
                videosDeleted: videos.length,
                filesDeleted: filesDeleted
              }
            });
          });
        });
      });
    });
  });
});

// Video upload endpoint
app.post('/api/videos', authenticateToken, (req, res) => {
  const uploadHandler = upload.single('video');
  
  uploadHandler(req, res, function(err) {
    if (err) {
      console.error('Upload error:', err);
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File too large. Maximum size is 500MB.' });
        }
      }
      return res.status(400).json({ error: err.message });
    }
    
    const { title, description, video_type = 'file' } = req.body;
    const userId = req.user.id;

    let videoUrl = req.body.video_url; // For link uploads

    if (req.file) {
      videoUrl = `/uploads/${req.file.filename}`;
      console.log('File uploaded successfully:', req.file.filename);
    }

    if (!videoUrl) {
      return res.status(400).json({ error: 'Video URL or file is required' });
    }

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    db.run(
      'INSERT INTO videos (title, description, video_url, video_type, user_id) VALUES (?, ?, ?, ?, ?)',
      [title.trim(), description || '', videoUrl, video_type, userId],
      function(err) {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Failed to upload video to database' });
        }
        
        res.json({ 
          message: 'Video uploaded successfully',
          video: {
            id: this.lastID,
            title: title.trim(),
            description: description || '',
            video_url: videoUrl,
            video_type,
            user_id: userId
          }
        });
      }
    );
  });
});

// Get all videos endpoint
app.get('/api/videos', (req, res) => {
  const query = `
    SELECT v.*, u.name as user_name 
    FROM videos v 
    JOIN users u ON v.user_id = u.id 
    ORDER BY v.created_at DESC
  `;
  
  db.all(query, (err, videos) => {
    if (err) {
      console.error('Error fetching videos:', err);
      return res.status(500).json({ error: 'Failed to fetch videos' });
    }
    res.json(videos);
  });
});

// Get user's videos endpoint
app.get('/api/videos/my-videos', authenticateToken, (req, res) => {
  const userId = req.user.id;
  
  db.all(
    'SELECT * FROM videos WHERE user_id = ? ORDER BY created_at DESC',
    [userId],
    (err, videos) => {
      if (err) {
        console.error('Error fetching user videos:', err);
        return res.status(500).json({ error: 'Failed to fetch videos' });
      }
      res.json(videos);
    }
  );
});

// Get single video endpoint
app.get('/api/videos/:id', (req, res) => {
  const videoId = req.params.id;
  
  const query = `
    SELECT v.*, u.name as user_name 
    FROM videos v 
    JOIN users u ON v.user_id = u.id 
    WHERE v.id = ?
  `;
  
  db.get(query, [videoId], (err, video) => {
    if (err) {
      console.error('Error fetching video:', err);
      return res.status(500).json({ error: 'Failed to fetch video' });
    }
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    res.json(video);
  });
});

// Delete video endpoint
app.delete('/api/videos/:id', authenticateToken, (req, res) => {
  const videoId = req.params.id;
  const userId = req.user.id;

  // First get the video to check ownership and file path
  db.get('SELECT * FROM videos WHERE id = ?', [videoId], (err, video) => {
    if (err) {
      console.error('Error fetching video for deletion:', err);
      return res.status(500).json({ error: 'Failed to delete video' });
    }
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    if (video.user_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Delete the video file if it's a local upload
    if (video.video_type === 'file' && video.video_url) {
      const filePath = path.join(__dirname, video.video_url);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          console.log(`Deleted video file: ${filePath}`);
        } catch (fileError) {
          console.error(`Error deleting file ${filePath}:`, fileError);
        }
      }
    }
    
    // Delete from database
    db.run(
      'DELETE FROM videos WHERE id = ?',
      [videoId],
      function(err) {
        if (err) {
          console.error('Error deleting video from database:', err);
          return res.status(500).json({ error: 'Failed to delete video from database' });
        }
        
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Video not found' });
        }
        
        res.json({ message: 'Video deleted successfully' });
      }
    );
  });
});

// Debug endpoint for testing uploads
app.post('/api/debug-upload', upload.single('video'), (req, res) => {
  console.log('Debug upload - Body:', req.body);
  console.log('Debug upload - File:', req.file);
  
  if (req.file) {
    res.json({ 
      success: true,
      message: 'File received successfully',
      file: {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        filename: req.file.filename
      }
    });
  } else {
    res.status(400).json({ 
      success: false,
      error: 'No file received' 
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'VideoShare API'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📁 Uploads directory: ${uploadsDir}`);
  console.log(`🔗 API Base URL: http://localhost:${PORT}/api`);
  console.log(`🎥 Video storage: http://localhost:${PORT}/uploads`);
});