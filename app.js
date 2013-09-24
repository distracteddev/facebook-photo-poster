/**
 * Module dependencies.
 */
var appPath = __dirname + '/app'
    , express = require('express')
    , http = require('http')
    , path = require('path')
    , fs = require('fs')
    , mongoose = require('mongoose')
    , graph = require('fbgraph')
    , dirty = require('dirty')
    , db    = dirty('data')
    , everyauth = require('everyauth');

// if you like to see what is going on, set this to true
everyauth.debug = false;

/** Connect to database and load models **/
mongoose.connect('mongodb://127.0.0.1/mymongodb');
var models_path = appPath + '/models';
fs.readdirSync(models_path).forEach(function (file) {
    require(models_path+'/'+file)
});
var UserModel = mongoose.model('UserModel');

/**
 * Social login integration using Facebook
 */
everyauth.everymodule.findUserById(function(userId,callback) {
    UserModel.findOne({facebook_id: userId},function(err, user) {
        callback(user, err);
    });
});

var USER_ID = 515390438;

// var PETCUREAN_ADMIN_ID =
var PETCUREAN_PAGE_ID = 109670772397760
var PETCUREAN_PAGE_TOKEN = "CAAFm4rS3c1UBAGQZAYvWtdk4AiJTDxaNmzxnZCeOIrX5quRkxeHdtk168NhgVDATwGpCYoTGkl7fkT1kywoSo0PR0rguXyL6VbWdBWZAjbJpoZBFPooRlbXG4lOZCD4nZAUoiZBOIhHvISKygnKqz3VdKoTVnFpEHZAwVZA5WsWcOmcdreoNKBEMTImbmkHmSm9oZD"

everyauth.facebook
    .appId('394598857274197')
    .appSecret('9f32ed2ce3bc4f1ea8625948b3ecb71f')
    .scope('email,user_location,user_photos,publish_actions,publish_stream,manage_pages,offline_access')
    .handleAuthCallbackError( function (req, res) {
        res.send('Error occured');
    })
    .findOrCreateUser( function (session, accessToken, accessTokExtra, fbUserMetadata) {
        // console.log('findOrCreate Args', arguments);
        var promise = this.Promise();
        UserModel.findOne({facebook_id: fbUserMetadata.id},function(err, user) {
            if (err) return promise.fulfill([err]);

            if(user) {

                // user found, life is good
                graph.setAccessToken(accessToken);
                graph.extendAccessToken({
                  client_id: '394598857274197',
                  client_secret: '9f32ed2ce3bc4f1ea8625948b3ecb71f'
                }, function(err, data) {
                  if (err) {
                    return console.error('Error Extending Access Token', err);
                  }
                  console.log('Successfully Extended Access Token', data.access_token)
                  user.facebook_token = data.access_token;
                  user.save();

                });

                promise.fulfill(user);

            } else {

                // create new user
                var User = new UserModel({
                    name: fbUserMetadata.name,
                    firstname: fbUserMetadata.first_name,
                    lastname: fbUserMetadata.last_name,
                    email: fbUserMetadata.email,
                    username: fbUserMetadata.username,
                    gender: fbUserMetadata.gender,
                    facebook_id: fbUserMetadata.id,
                    facebook_token: accessToken,
                    facebook: fbUserMetadata
                });

                User.save(function(err,user) {
                    if (err) return promise.fulfill([err]);
                    promise.fulfill(user);
                });

            }


        });

        return promise;
    })
    .redirectPath('/');

/**
 * Start and setup express
 * @type {*}
 */
var app = express();
app.configure(function(){
  app.set('port', process.env.PORT || 3700);
  app.set('views', appPath + '/views');
  app.set('view engine', 'ejs');
  app.use(express.favicon());
  app.use(express.logger('dev'));
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(express.cookieParser('super secret'));
  app.use(express.session());
  app.use('/images', express.static(path.join(__dirname, 'images')));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(everyauth.middleware(app)); // important to call this AFTER session!
  app.use(app.router);

});

app.configure('development', function(){
  app.use(express.errorHandler());
});

/**
 * Routing to "controllers", seems important that we only include
 * our controllers at this point, or our models will not be passed
 * to them.
 */
var index = require(appPath + '/controllers/index')
    , user = require(appPath + '/controllers/user');
app.get('/', index.index);
app.get('/user',user.index);

var albums = [];
albums.push({name: 'Test1', id: '982'})
albums.push({name: 'Test2', id: '467'})
albums.push({name: 'Test3', id: '124'})

app.get('/selectAlbum', function(req, res) {
  graph.setAccessToken(PETCUREAN_PAGE_TOKEN);
  graph.get(PETCUREAN_PAGE_ID + '/albums', function(err, graphRes) {
    //console.log('res', graphRes);
    res.render('selectAlbum', {albums: graphRes.data})
  })
});

app.post('/selectAlbum', function(req, res) {
  console.log(req.body);
  db.set('ALBUM_ID', req.body.album);
  res.render('selectedAlbum');
});

var postPhoto =  function(req, res, imgUrl) {
  var postData = {url : 'http://dev.socialmosa.com:3700/' + imgUrl};
  var postURL = db.get('ALBUM_ID') + '/photos';

  console.log('postData', postData);
  console.log('postURL', postURL);

  graph.setAccessToken(PETCUREAN_PAGE_TOKEN);
  graph.post(postURL, postData, function(err, data) {
    console.log('Posted Photo', err, data)
    res.send(data);
  })
};


app.post('/photo', function(req, res) {
  // console.log(req.body.uri);
  if (req.body.uri) {
    console.log('Parsing Data URI');
    var imgUrl = parseDataURI(req.body.uri);
    console.log('Done Parsing Data URI');
    postPhoto(req, res, imgUrl);
  }
});

function parseDataURI(string) {
  var fs = require('fs');
  var regex = /^data:.+\/(.+);base64,(.*)$/;

  var matches = string.match(regex);
  var ext = matches[1];
  var data = matches[2];
  var buffer = new Buffer(data, 'base64');
  var fileName = 'images/' + Date.now() + '.' + ext;
  fs.writeFileSync(fileName, buffer);
  return fileName;
}


app.get('/facebookimg', function(res, res) {
  res.sendfile('data.png');
});


/**
 * Start listening
 */
http.createServer(app).listen(app.get('port'), function(){
  console.log("Express server listening on port " + app.get('port'));
});
