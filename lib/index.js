'use strict';
var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var path = require('path');
var Inflector = require('inflected');

var allowedTypes = ['number', 'integer', 'long', 'float', 'double', 'string', 'password', 'boolean', 'date', 'dateTime', 'array'];
var definitions = null;
var swaggerVersion = null;
var v2MongooseProperty = 'x-swagger-mongoose';
var v1MongooseProperty = '_mongoose';
var xSwaggerMongoose = {
  schemaOptions: {},
  additionalProperties: {},
  excludeSchema: {},
  documentIndex: {},
  isJsonApi: {},
  keyConversion: false
};
var validators = {};

var propertyMap = function (property) {
  switch (property.type) {
    case 'number':
      switch (property.format) {
        case 'integer':
        case 'long':
        case 'float':
        case 'double':
          return Number;
        default:
          throw new Error('Unrecognised schema format: ' + property.format);
      }
    case 'integer':
    case 'long' :
    case 'float' :
    case 'double' :
      return Number;
    case 'string':
    case 'password':
      return String;
    case 'boolean':
      return Boolean;
    case 'date':
    case 'dateTime':
      return Date;
    case 'array':
      return [propertyMap(property.items)];
    default:
      throw new Error('Unrecognized schema type: ' + property.type);
  }
};

var convertToJSON = function (spec) {
  var swaggerJSON = {};
  var type = typeof(spec);
  switch (type) {
    case 'object':
      if (spec instanceof Buffer) {
        swaggerJSON = JSON.parse(spec);
      } else {
        swaggerJSON = spec;
      }
      break;
    case 'string':
      swaggerJSON = JSON.parse(spec);
      break;
    default:
      throw new Error('Unknown or invalid spec object');
      break;
  }
  return swaggerJSON;
};

var isSimpleSchema = function (schema) {
  return schema.type && isAllowedType(schema.type);
};

var isAllowedType = function (type) {
  return allowedTypes.indexOf(type) != -1;
};

var isPropertyWithRef = function (property) {
  return property.$ref || ((property.type == 'array') && (property.items.$ref));
};

var fillRequired = function (object, key, template) {
  if (template && Array.isArray(template) && template.indexOf(key) >= 0) {
    object[key].required = true;
  } else if (typeof template === 'boolean') {
    object[key].required = template;
  }
};

var applyExtraDefinitions = function (definitions, _extraDefinitions) {
  if (_extraDefinitions) {
    if (_.isString(_extraDefinitions)) {
      _extraDefinitions = JSON.parse(_extraDefinitions);
    }

    var mongooseProperty = getMongooseProperty();

    //remove default object from extra, we're going to handle that seperately
    var defaultDefs;
    if (!_extraDefinitions.default) {
      defaultDefs = null;
    } else {
      defaultDefs = _extraDefinitions.default;
      delete _extraDefinitions.default;
      _.each(definitions, function (val){
        //lets add that default to everything.
        val[mongooseProperty] = defaultDefs;
      });
    }

    var extraDefinitions = _extraDefinitions;
    _.each(extraDefinitions, function (val, key) {
      definitions[key][mongooseProperty] = val;
    });

  }
};

var isAtLeastSwagger2 = function() {
  return swaggerVersion >= 2;
};

var getMongooseProperty = function() {
  return (isAtLeastSwagger2()) ? v2MongooseProperty : v1MongooseProperty;
};

var isMongooseProperty = function (property) {
  return !!property[getMongooseProperty()];
};

var isMongooseArray = function (property) {
  return property.items && property.items[getMongooseProperty()];
};

var getMongooseReference = function (obj, ref) {
  var ret = {};
  if (!isAtLeastSwagger2()) {
    if (obj.type === 'objectId') {
      ret.type = Schema.Types.ObjectId;
      if (obj.includeSwaggerRef !== false) {
        ret.ref = ref.replace('#/definitions/', '');
      }
    }
  } else {
    ret.type = Schema.Types.ObjectId;
    ret.ref = ref.replace('#/definitions/', '');
  }
  return ret;
};

var getMongooseSpecific = function (schema, property) {
  var mongooseProperty = getMongooseProperty();
  var mongooseSpecific = property[mongooseProperty];
  var ref = (isAtLeastSwagger2() && mongooseSpecific) ? mongooseSpecific.$ref : property.$ref;

  if (!mongooseSpecific && isMongooseArray(property)) {
    mongooseSpecific = property.items[mongooseProperty];
    ref = (isAtLeastSwagger2()) ? mongooseSpecific.$ref : property.items.$ref;
  }

  if (!mongooseSpecific) {
    return schema;
  }

  var ret = {};
  if (ref) {
    _.extend(ret, getMongooseReference(mongooseSpecific, ref));
  } else if (mongooseSpecific.validator) {
    var validator = validators[mongooseSpecific.validator];
    _.extend(ret, property, {validate: validator});
    delete ret[mongooseProperty];
  } else {
    _.extend(ret, property, mongooseSpecific);
    delete ret[mongooseProperty];
    if (isSimpleSchema(ret)) {
      ret.type = propertyMap(ret);
    }
  }

  return ret;
};

var isMongodbReserved = function (fieldKey) {
  return fieldKey === '_id' || fieldKey === '__v';
};

var getReferenceType = function(property) {
  var refRegExp = /^#\/definitions\/(\w*)$/;
  var refString = property.$ref ? property.$ref : property.items.$ref;
  return refString.match(refRegExp)[1];
};

var processRef = function (property, objectName, schema, key, required) {
  var propType = getReferenceType(property);
  // NOT circular reference
  if (propType !== objectName) {
    var object = definitions[propType];
    if (~['array', 'object'].indexOf(object.type)) {
      var isJsonApi = hasJsonApiOption(propType);
      var result = getSchema(propType, object.properties ? object.properties : object, isJsonApi);
      schema[key] = property.items || object.type === 'array' ? [result] : result;
    } else {
      var clone = _.extend({}, object);
      delete clone[getMongooseProperty()];
      var schemaProp = getSchemaFromProperty(clone, key)[key];
      schema[key] = property.items ? [schemaProp] : schemaProp;
    }
  } else {
    // circular reference
    if (propType) {
      schema[key] = {
        type: Schema.Types.ObjectId,
        ref: propType
      };
    }
  }
  fillRequired(schema, key, required);
};

var allowedResourceKeys = ['id', 'type', 'attributes', 'relationships', 'links', 'meta'];

var getSchemaFromAttributes = function (attributes, objectName) {
  var schema = {};
  var required = attributes.required || [];
  var properties = attributes.properties ? attributes.properties : attributes;

  _.forEach(properties, function (property, key) {
    _.extend(schema, getSchemaFromProperty(property, key, required, objectName, {}));
  });

  return schema;
};

var getRelationshipPropertyType = function (data, defaultType) {
  // NOTE: use mongoose override type first, then type's enum value, otherwise use default
  if (_.has(data, `${mongooseProperty}.type`)) {
    return _.get(data, `${mongooseProperty}.type`);
  } else {
    return _.get(data, 'type.enum[0]', defaultType);
  }
};

var getSchemaFromRelationships = function (relationships, objectName) {
  var schema = {};

  _.forEach(relationships, function(relationship, key) {
    var type;
    var mongooseProperty = getMongooseProperty();

    if (relationship.data) {
      type = getRelationshipPropertyType(relationship.data, key);

      ret.type = Schema.Types.ObjectId;
      ret.ref = ref.replace('#/definitions/', '');

      schema[key] = getMongooseReference(relationship.data, ref);
    }
    else if (relationship.$ref) {
      var propType = getReferenceType(property);
      // NOT circular reference
      if (propType !== objectName) {
        var object = definitions[propType];
        if (object.type !== 'object' && _.has(object, 'properties')) {
          throw new Error(`The ${objectName} definition's ${key} relationship must reference a resource identifier.`);
        }
        if (!_.has(object, 'properties.type') && !_.has(object, 'properties.id')) {
          throw new Error(`The ${objectName} definition's ${key} relationship must point to a resource identifier with both id and type properties.`);
        }
        type = getRelationshipPropertyType(object.properties, propType);
        schema[key] = {
          type: Schema.Types.ObjectId,
          ref: type
        };
      } else {
        // circular reference
        if (propType) {
          schema[key] = {
            type: Schema.Types.ObjectId,
            ref: propType
          };
        }
      }
    }
  });

  return schema;
};

var getSchemaFromResourceObject = function (resource, objectName) {
  var properties = resource.properties;

  if (!_.has(properties, 'type') && !_.has(properties, 'id')) {
    throw new Error('Resource objects must contain both an id and type property');
  }

  var invalidKeys = _.difference(_.keys(properties), allowedResourceKeys);
  if (invalidKeys.length > 0) {
    throw new Error('Resource object contains properties not within the JSON API Specification');
  }

  var schema = {};

  if (properties.attributes) {
    _.extend(schema, getSchemaFromAttributes(properties.attributes, objectName));
  }
  if (properties.relationships) {
    _.extend(schema, getSchemaFromRelationships(properties.relationships, objectName));
  }
  if (properties.meta) {
    _.extend(schema, getSchemaFromProperty(properties.meta, 'meta', [], objectName, {}));
  }

  return schema;
};

var getSchema = function (objectName, fullObject, isJsonApi) {
  var schema = {};

  if (isJsonApi) {
    var schemaProperties = getSchemaFromResourceObject(fullObject, objectName);
    _.extend(schema, schemaProperties);
  } else {
    var required = fullObject.required || [];
    var properties = fullObject.properties ? fullObject.properties : fullObject;
    _.forEach(properties, function (property, key) {
      _.extend(schema, getSchemaFromProperty(property, key, required, objectName, properties));
    });
  }

  return schema;
};

var convertKey = function convertKey(key) {
  switch (xSwaggerMongoose.keyConversion) {
    case 'camelcase':
      return Inflector.camelize(Inflector.underscore(key), false);
    case 'underscore':
      return Inflector.underscore(key);
    default:
      return key;
  }
};

var getSchemaFromProperty = function(property, key, required, objectName, object) {
  var schema = {};
  if (isMongodbReserved(key) === true) {
    return;
  }

  key = convertKey(key);

  if (isMongooseProperty(property)) {
    schema[key] = getMongooseSpecific(schema, property);
  }
  else if (isMongooseArray(property)) {
    schema[key] = [getMongooseSpecific(schema, property)];
  }
  else if (isPropertyWithRef(property)) {
    debugger
    processRef(property, objectName, schema, key, required);
  }
  else if (property.type !== 'object') {
    var type = propertyMap(property);
    if (property.enum && _.isArray(property.enum)) {
      schema[key] = {type: type, enum: property.enum};
    } else {
      schema[key] = {type: type};
    }
  }
  else if (property.type === 'object') {
    schema[key] = getSchema(key, property, false);
  }
  // TODO: Is it possible to reach this code? if property.type is null/undefined, it still reaches code above...
  else if (isSimpleSchema(object)) {
    schema = {type: propertyMap(object)};
  }

  if (required) {
    fillRequired(schema, key, required);
  }

  // TODO: Add support for allOf

  return schema;
};

var processDocumentIndex = function(schema, index){
  //TODO: check indicies are numbers
  var isUniqueIndex = false;
  if (_.isEmpty(index)) {
    return;
  }
  if (index.unique) {
    isUniqueIndex = true;
  }
  delete index.unique;
  if (isUniqueIndex) {
    schema.index(index, {unique:true});
  } else {
    schema.index(index);
  }

};

var hasJsonApiOption = function(key) {
  var customMongooseProperty = getMongooseProperty();
  var isJsonApiDefault = _.get(xSwaggerMongoose, `isJsonApi.${customMongooseProperty}`, false);
  return _.get(xSwaggerMongoose, `isJsonApi.${key}`, isJsonApiDefault);
};

module.exports.compileAsync = function (spec, callback) {
  try {
    callback(null, this.compile(spec));
  } catch (err) {
    callback({message: err}, null);
  }
};

module.exports.compile = function (spec, _extraDefinitions) {
  if (!spec) throw new Error('Swagger spec not supplied');
  var swaggerJSON = convertToJSON(spec);
  if (swaggerJSON.swagger) {
    swaggerVersion = new Number(swaggerJSON.swagger);
  }


  definitions = swaggerJSON.definitions;

  applyExtraDefinitions(definitions, _extraDefinitions);

  var customMongooseProperty = getMongooseProperty();

  if (swaggerJSON[customMongooseProperty]) {
    processMongooseDefinition(customMongooseProperty, swaggerJSON[customMongooseProperty]);
  }

  var schemas = {};
  _.forEach(definitions, function (definition, key) {
    var object;
    var options = xSwaggerMongoose.schemaOptions;
    var excludedSchema = xSwaggerMongoose.excludeSchema;
    var documentIndex = xSwaggerMongoose.documentIndex[key];
    var isJsonApi = hasJsonApiOption(key);

    if (definition[customMongooseProperty]) {
      processMongooseDefinition(key, definition[customMongooseProperty]);
    }
    if (excludedSchema[key]) {
      return;
    }
    object = getSchema(key, definition, isJsonApi);
    if (options) {
      options = _.extend({}, options[customMongooseProperty], options[key]);
    }
    if (typeof excludedSchema === 'object') {
      excludedSchema = excludedSchema[customMongooseProperty] || excludedSchema[key];
    }
    if (object && !excludedSchema) {
      var additionalProperties = _.extend({}, xSwaggerMongoose.additionalProperties[customMongooseProperty], xSwaggerMongoose.additionalProperties[key]);
      additionalProperties = processAdditionalProperties(additionalProperties, key);
      object = _.extend(object, additionalProperties);
      var schema = new Schema(object, options);

      if (isJsonApi) {
        // Duplicate the ID field.
        schema.virtual('id').get(function(){
          return this._id.toHexString();
        });
        // Ensure virtual fields are serialised.
        schema.set('toJSON', {
          virtuals: true
        });
      }

      processDocumentIndex(schema, documentIndex);
      schemas[key] = schema;
    }
  });

  var models = {};
  _.forEach(schemas, function (schema, key) {
    models[key] = mongoose.model(key, schema);
  });

  return {
    schemas: schemas,
    models: models
  };
};

var processMongooseDefinition = function(key, customOptions) {
  if (customOptions) {
    if (customOptions['json-api']) {
      xSwaggerMongoose.isJsonApi[key] = customOptions['json-api'];
    }
    if (customOptions['key-conversion']) {
      xSwaggerMongoose.keyConversion = customOptions['key-conversion'];
    }
    if (customOptions['schema-options']) {
      xSwaggerMongoose.schemaOptions[key] = customOptions['schema-options'];
    }
    if (customOptions['exclude-schema']) {
      xSwaggerMongoose.excludeSchema[key] = customOptions['exclude-schema'];
    }
    if (customOptions['additional-properties']) {
      xSwaggerMongoose.additionalProperties[key] = customOptions['additional-properties'];
    }
    if (customOptions.index) {
      xSwaggerMongoose.documentIndex[key] = customOptions.index;
    }
    if (customOptions.validators) {
      var validatorsDirectory = path.resolve(process.cwd(),customOptions.validators);
      validators = require(validatorsDirectory);
    }

  }
};

var processAdditionalProperties = function(additionalProperties, objectName) {
  var schema = {};
  var customMongooseProperty = getMongooseProperty();
  _.each(additionalProperties, function (property, key) {
    var modifiedProperty = {};
    modifiedProperty[customMongooseProperty] = property;
    schema = _.extend(schema, getSchemaFromProperty(modifiedProperty, key, property.required, objectName));
  });
  return schema;
};
