/* jshint mocha: true, -W024, expr:true */

'use strict';
var swaggerMongoose = require('./../lib/index');

var fs = require('fs');
var async = require('async');
var YAML = require('yamljs');
var mongoose = require('mongoose');
mongoose.Promise = global.Promise; // Mongoose's default Promise is deprecated
var Mockgoose = require('mockgoose').Mockgoose;
var mockgoose = new Mockgoose(mongoose);
var chai = require('chai');
var Schema = mongoose.Schema;
var _ = require('lodash');
var JSONAPISerializer = require('jsonapi-serializer').Serializer;

var { assert, expect } = chai;

describe('swagger-mongoose tests', function () {

  before(function(done) {
    mockgoose.prepareStorage().then(function() {
      mongoose.connect('mongodb://127.0.0.1:27017/TestingDB', function(err) {
        done(err);
      });
    });
  });

  afterEach(function (done) {
    delete mongoose.models.Pet;
    delete mongoose.models.Address;
    delete mongoose.models.Error;
    delete mongoose.models.Person;
    delete mongoose.models.House;
    delete mongoose.models.Car;
    delete mongoose.models.Human;
    mockgoose.helper.reset()
    .then(function () {
      done();
    });
  });

  it('should create an example pet and return all valid properties', function (done) {
    var swagger = fs.readFileSync('./test/petstore.json');
    var Pet = swaggerMongoose.compile(swagger).models.Pet;
    var myPet = new Pet({
      id: 123,
      name: 'Fluffy',
      dob: new Date(),
      price: 99.99,
      sold: true,
      friends: ['Barney', 'Fido'],
      favoriteNumbers: [1, 3, 7, 9],
      address: [
        {addressLine1: '1 Main St.'},
        {addressLine1: '2 Main St.'}
      ],
      notAKey: 'test'
    });
    myPet.save(function (err) {
      if (err) throw err;
      Pet.findOne({id: 123}, function (err, data) {
        assert(data.id === 123, 'ID mismatch');
        assert(data.name === 'Fluffy', 'Name mismatch');
        assert(data.price === 99.99, 'Price mismatch');
        assert(data.sold === true, 'Sold mismatch');
        assert(data.friends.length === 2, 'Friends mismatch');
        assert(data.favoriteNumbers.length === 4, 'Favorite numbers mismatch');
        assert(data.address[0].addressLine1 === '1 Main St.', 'Nested address mismatch');
        assert(data.address[1].addressLine1 === '2 Main St.', 'Nested address mismatch');
        assert(!data.notAKey, 'Strict schema mismatch');
        done();
      });
    });
  });

  it('should not create an example without required field', function (done) {
    var swagger = fs.readFileSync('./test/petstore.json');
    var Pet = swaggerMongoose.compile(swagger).models.Pet;
    var myPet = new Pet({
      id: 123
    });
    myPet.save(function (err) {
      assert(err, 'ValidationError: name: Path `name` is required.');
      assert(err._message === 'Pet validation failed', 'Unexpected error message');
      done();
    });
  });

  it('should create an example pet from a file', function (done) {
    var swagger = fs.readFileSync('./test/petstore.json');
    var Pet = swaggerMongoose.compile(swagger).models.Pet;
    var myPet = new Pet({
      id: 123,
      name: 'Fluffy'
    });
    myPet.save(function (err) {
      if (err) throw err;
      Pet.findOne({id: 123}, function (err, data) {
        assert(data.id === 123, 'ID mismatch');
        assert(data.name === 'Fluffy', 'Name mismatch');
        done();
      });
    });
  });

  it('should create an example pet from a JSON object', function (done) {
    var swagger = fs.readFileSync('./test/petstore.json');
    var Pet = swaggerMongoose.compile(JSON.parse(swagger)).models.Pet;
    var myPet = new Pet({
      id: 123,
      name: 'Fluffy'
    });
    myPet.save(function (err) {
      if (err) throw err;
      Pet.findOne({id: 123}, function (err, data) {
        assert(data.id === 123, 'ID mismatch');
        assert(data.name === 'Fluffy', 'Name mismatch');
        done();
      });
    });
  });

  it('should create an example pet from a string', function (done) {
    var swagger = fs.readFileSync('./test/petstore.json');
    var Pet = swaggerMongoose.compile(swagger.toString()).models.Pet;
    var myPet = new Pet({
      id: 123,
      name: 'Fluffy'
    });
    myPet.save(function (err) {
      if (err) throw err;
      Pet.findOne({id: 123}, function (err, data) {
        assert(data.id === 123, 'ID mismatch');
        assert(data.name === 'Fluffy', 'Name mismatch');
        done();
      });
    });
  });

  it('should create an example person with relations to external collections', function (done) {
    var swagger = fs.readFileSync('./test/person.json');


    var models = swaggerMongoose.compile(swagger.toString()).models;

    var Person = models.Person;
    var House = models.House;
    var Car = models.Car;
    assert(Person.schema.paths.cars.options.type[0].type === Schema.Types.ObjectId, 'Wrong "car" type');
    assert(Person.schema.paths.houses.options.type[0].type === Schema.Types.ObjectId, 'Wrong "house" type');
    assert(Person.schema.paths.houses.options.type[0].ref === 'House', 'Ref to "house" should be "House"');

    async.parallel({
      house: function (cb) {
        var house = new House({
          description: 'Cool house',
          lng: 50.3,
          lat: 30
        });
        house.save(function (err, data) {
          cb(err, data);
        });
      },
      car: function (cb) {
        var car = new Car({
          provider: 'Mazda',
          model: 'CX-5'
        });
        car.save(function (err, data) {
          cb(err, data);
        });
      }
    }, function (err, results) {
      var person = new Person({
        login: 'jb@mi6.gov',
        firstName: 'James',
        lastName: 'Bond',
        houses: [
          results.house._id
        ],
        cars: [
          results.car._id
        ],
        phone: {
          home: '(123) 456-7890',
          mobile: '(012) 345-6789'
        }
      });
      person.save(function (err, data) {
        Person
          .findOne({_id: data._id})
          .lean()
          .exec(function (err, newPerson) {
            async.parallel({
              car: function (cb) {
                Car.findOne({_id: newPerson.cars[0]}, function (err, car) {
                  cb(err, car);
                });
              },
              house: function (cb) {
                House.findOne({_id: newPerson.houses[0]}, function (err, house) {
                  cb(err, house);
                });
              }
            }, function (err, populated) {
              newPerson.cars = [populated.car];
              newPerson.houses = [populated.house];

              assert(newPerson.login === 'jb@mi6.gov', 'Login is incorrect');
              assert(newPerson.firstName === 'James', 'First Name is incorrect');
              assert(newPerson.lastName === 'Bond', 'Last Name is incorrect');
              assert(newPerson.cars.length === 1, 'Cars content is wrong');
              assert(newPerson.cars[0].model === 'CX-5', 'Car model is incorrect');
              assert(newPerson.cars[0].provider === 'Mazda', 'Car provider is incorrect');
              assert(newPerson.houses.length === 1, 'Houses content is wrong');
              assert(newPerson.houses[0].lat === 30, 'House latitude is incorrect');
              assert(newPerson.houses[0].lng === 50.3, 'House longitude is incorrect');
              assert(newPerson.houses[0].description === 'Cool house', 'House description is incorrect');
              assert(newPerson.phone.home === '(123) 456-7890', 'Home phone number is incorrect');
              assert(newPerson.phone.mobile === '(012) 345-6789', 'Mobile phone number is incorrect');

              done();
            });
          });
      });
    });
  });

  it('should identify return indicies from the swagger document', function (done) {
      var swagger = fs.readFileSync('./test/person.json');
      var models = swaggerMongoose.compile(swagger.toString()).models;
      var Human = models.Human;
      var Person = models.Person;
      var House = models.House;
      assert.propertyVal(Person.schema.paths.login._index, 'unique', 'true', 'Person.login should have a unique index');
      assert.sameDeepMembers(Human.schema._indexes[0], [ { firstName: 1, lastName: 1 },{ unique: true, background: true } ], 'Human document should have an object of firstName/lastName, and a unique:true object');
      assert.sameDeepMembers(House.schema._indexes[0], [ { lng: 1, lat: 1 }, { background: true } ], 'House document should have an object of lng/lat, but not a unique key');

      done();

    });

  it('should identify and throw errors on duplicate properties marked unique', function (done) {
      var swagger = fs.readFileSync('./test/person.json');
      var models = swaggerMongoose.compile(swagger.toString()).models;
      var Person = models.Person;

      var person = new Person({
        login: 'jb@mi6.gov',
        firstName: 'James',
        lastName: 'Bond',
        phone: {
          home: '(123) 456-7890',
          mobile: '(012) 345-6789'
        }
      });
      person.save(function(){
        var copyCat = new Person({
          login: 'jb@mi6.gov',
          firstName: 'Jake',
          lastName: 'Barrington',
        });
        copyCat.save(function(err){
          if(err){
            assert.equal(err.name, 'MongoError');
            assert.include(err.errmsg, 'duplicate key');
            assert.include(err.errmsg, 'jb@mi6.gov');
            done();
          } else {
            assert.fail('unique index should have prevented this');
            done();
          }
        });
      });
    });

  it('should identify and throw errors on compound indices marked unique', function (done) {
      var swagger = fs.readFileSync('./test/person.json');
      var models = swaggerMongoose.compile(swagger.toString()).models;
      var Human = models.Human;
      var human = new Human({
        firstName: 'James',
        lastName: 'Bond'
      });
      human.save(function(){
        var copyCat = new Human({
          firstName: 'James',
          lastName: 'Bond'
        });
        copyCat.save(function(err,data){
          if (err) {
            assert.equal(err.name, 'MongoError');
            assert.include(err.errmsg, 'duplicate key');
            assert.include(err.errmsg, '{ : "James", : "Bond" }');
            done();
          } else {
            assert.ok(data);
            done();
          }
        });
      });

    });

  it('should allow for external validators', function (done) {
      var swagger = fs.readFileSync('./test/person.json');
      var models = swaggerMongoose.compile(swagger.toString()).models;
      var Person = models.Person;

      var person = new Person({
        login: 'jb@mi6.gov',
        firstName: 'James',
        lastName: 'Bond',
        phone: {
          home: '(123) 456-789',
          mobile: '(012) 345-6789'
        }
      });

      person.save(function(err){
        if(err){
          var expectedErrorMessage = _.get(err, 'errors[\'phone.home\'].message');
          assert.equal(err.name, 'ValidationError');
          assert.include(expectedErrorMessage, 'is not a valid home phone number!');
          done();
        } else {
          assert.fail('phone validator should have prevented this');
          done();
        }
      });
    });

  it('should identify and add enum to schema', function (done) {
      var swagger = fs.readFileSync('./test/person.json');
      var models = swaggerMongoose.compile(swagger.toString()).models;
      var Car = models.Car;

      var car = new Car({
        provider: 'Soviet Motors',
        model: 'Gremlin'
      });

      car.save(function(err){
        if(err){
          var expectedErrorMessage = _.get(err, 'errors.provider.message');
          assert.equal(err.name, 'ValidationError');
          assert.include(expectedErrorMessage, 'is not a valid enum value');
          done();
        } else {
          assert.fail('enum for car should have prevented this');
          done();
        }
      });
    });

  it('should create an example pet from a JSON object with default schema options', function (done) {
    var swagger = fs.readFileSync('./test/petstore.json');

    var Pet = swaggerMongoose.compile(JSON.parse(swagger), { default: { timestamps: true }}).models.Pet;
    var myPet = new Pet({
      id: 123,
      name: 'Fluffy'
    });
    myPet.save(function (err) {
      if (err) throw err;
      Pet.findOne({id: 123}, function (err, data) {
        assert(data.schema.paths.createdAt, 'createdAt timestamp not found in data');
        assert(data.schema.paths.updatedAt, 'updatedAt timestamp not found in data');
        done();
      });
    });
  });

  it('should create an example pet from a JSON object with opposite default schema options', function (done) {
    var swagger = fs.readFileSync('./test/petstore.json');

    var Pet = swaggerMongoose.compile(JSON.parse(swagger), { default: {'schema-options': { timestamps: false }}}).models.Pet;
    var myPet = new Pet({
      id: 123,
      name: 'Fluffy'
    });
    myPet.save(function (err) {
      if (err) throw err;
      Pet.findOne({id: 123}, function (err, data) {
        assert(!data.schema.paths.createdAt, 'createdAt timestamp found in data');
        assert(!data.schema.paths.updatedAt, 'updatedAt timestamp found in data');
        done();
      });
    });
  });

  it('should create an example pet from a JSON object with schema specific options overriding default options', function (done) {
    var swagger = fs.readFileSync('./test/petstore.json');
    var Pet = swaggerMongoose.compile(JSON.parse(swagger), { default: {'schema-options': { timestamps: true }}, Pet: {'schema-options': { timestamps: false }}}).models.Pet;
    var myPet = new Pet({
      id: 123,
      name: 'Fluffy'
    });
    myPet.save(function (err) {
      if (err) throw err;
      Pet.findOne({id: 123}, function (err, data) {
        assert(!data.schema.paths.createdAt, 'createdAt timestamp found in data');
        assert(!data.schema.paths.updatedAt, 'updatedAt timestamp found in data');
        done();
      });
    });
  });

  it('should create an example pet from a JSON object with schema specific options overriding default options', function (done) {
    var swagger = fs.readFileSync('./test/petstore.json');
    var Pet = swaggerMongoose.compile(JSON.parse(swagger), { default: {'schema-options': { timestamps: false }}, Pet: {'schema-options': { timestamps: true }}}).models.Pet;
    var myPet = new Pet({
      id: 123,
      name: 'Fluffy'
    });
    myPet.save(function (err) {
      if (err) throw err;
      Pet.findOne({id: 123}, function (err, data) {
        assert(data.schema.paths.createdAt, 'createdAt timestamp not found in data');
        assert(data.schema.paths.updatedAt, 'updatedAt timestamp not found in data');
        done();
      });
    });
  });

  it('should avoid reserved mongodb fields', function (done) {
    var swagger = fs.readFileSync('./test/person.json');
    var models = swaggerMongoose.compile(swagger.toString()).models;

    var Person = models.Person;

    // next logic is indicate that "_id" and "__v" fields are MongoDB native
    assert(Person.schema.paths._id.instance === 'ObjectID', 'Wrong "_id" attributes');
    assert(Person.schema.paths._id.options.type === Schema.Types.ObjectId, 'Wrong "_id" attributes');
    assert(Person.schema.paths.__v.instance === 'Number', 'Wrong "__v" attributes');
    assert(Person.schema.paths.__v.options.type === Number, 'Wrong "__v" attributes');

    done();
  });

  it('should process circular references', function (done) {
    var swagger = fs.readFileSync('./test/person.json');
    var models = swaggerMongoose.compile(swagger.toString()).models;

    var Human = models.Human;

    // next logic is indicate that circular references are processed
    assert(Human.schema.paths.father.instance === 'ObjectID', 'Wrong "father" attribute: instance');
    assert(Human.schema.paths.father.options.type === Schema.Types.ObjectId, 'Wrong "father" attribute: type');
    assert(Human.schema.paths.mother.instance === 'ObjectID', 'Wrong "mother" attribute: instance');
    assert(Human.schema.paths.mother.options.type === Schema.Types.ObjectId, 'Wrong "mother" attribute: type');

    done();
  });

  context('JSON API Tests', function () {
    afterEach(function (done) {
      delete mongoose.models.Person;
      delete mongoose.models.Address;
      delete mongoose.models.Phone;
      mockgoose.helper.reset().then(function () {
        done();
      });
    });

    beforeEach(function(){
      var yaml = fs.readFileSync('./test/jsonapi.yaml', 'utf8');
      var swagger = YAML.parse(yaml);
      this.models = swaggerMongoose.compile(swagger).models;
    });

    it('should process definitions which follow the JSON API specification', function() {
      var schema = this.models.Person.schema;
      expect(_.keys(schema.paths)).to.have.members([
        '__v',
        '_id',
        'address',
        'createdAt',
        'name',
        'numbers',
        'numExample',
        'type',
        'updatedAt',
      ]);
      expect(schema.paths.name.instance).to.equal('String');
      expect(schema.paths.name.options.type).to.equal(String);
      expect(schema.paths.numExample.instance).to.equal('Number');
      expect(schema.paths.numExample.options.type).to.equal(Number);
    });

    it('should be serialiable to JSON API format', function* () {
      var serializer = new JSONAPISerializer('Person', {
        id: '_id',
        attributes: ['name', 'numExample'],
        pluralizeType: false
      });

      var person = new this.models.Person({
        name: 'test',
        numExample: 42
      });
      yield person.save();

      var serialized = serializer.serialize(person);
      var expected = `{"data":{"type":"Person","id":"${person.id}","attributes":{"name":"test","num-example":42}}}`;
      var actual = JSON.stringify(serialized);

      expect(actual).to.equal(expected);
    });

    it('should process to-one and to-many relationships', function* () {
      var Person = this.models.Person;
      var Address = this.models.Address;
      var Phone = this.models.Phone;

      expect(Person).to.exist;
      expect(Address).to.exist;
      expect(Phone).to.exist;

      expect(Person.schema.paths.address.instance).to.equal("ObjectID");

      expect(Person.schema.paths.numbers.instance).to.equal('Array');
      expect(Person.schema.paths.numbers.options.type[0].type).to.equal(Schema.Types.ObjectId);
      expect(Person.schema.paths.numbers.options.type[0].ref).to.equal('Phone');

      var refs = yield {
        address: Address.create({
          line1: "9999 Street St.",
          line2: "",
          city: "City",
          state: "WI"
        }),
        phone: Phone.create({
          number: "(999) 999-9999"
        }),
      };

      var person = yield Person.create({
        name: "Sally",
        address: refs.address._id,
        numbers: [
          refs.phone._id
        ]
      });

      expect(person.name).to.equal("Sally");
      expect(person.address).to.equal(refs.address._id);
      expect(person.numbers[0]).to.equal(refs.phone._id);
    });
  });
});
