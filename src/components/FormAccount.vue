<template>
  <div class="FormAccount">
    <div>
      <div v-if="!buyAddress">
        <div id="account-group">
          <input
            v-model="localAddress"
            placeholder="Domain search"
            :id="`${type}-input`"
            :ref="`${type}-input`" >
        </div>
      </div>

      <div v-if="buyAddress">
        <div v-if="domains === null">
          <slot name="loading">
            <div class="text-info">Loading&hellip;</div>
            <br/>
          </slot>
        </div>

        <div v-if="domains && domains.length === 0">
          <slot name="nodomains">
            <div class="text-info">This wallet is not selling accounts</div>
            <br/>
          </slot>
        </div>

        <div id="account-group" v-if="domains && domains.length > 0">
          <input
            v-model="localAddress"
            placeholder="User name search"
            :id="`${type}-input`"
            :ref="`${type}-input`" >

          <div id="separator">
            <span>@</span>
          </div>

          <!-- TODO if only one domain, show as div -->
          <select
            v-model="selectedDomain"
            placeholder="Domain"
            id="domains" >
            <option v-for="domain in domains" :value="domain" :key="domain">
              {{domain}}
            </option>
          </select>
        </div>
      </div>
    </div>

    <slot></slot>

  </div>
</template>

<script>
import {isValidAddress} from '../validate'

export default {
  name: "FormAccount",
  props: {
    value: {
      type: String,
      default: '',
    },

    valid: {
      type: Boolean
    },

    buyAddress: {
      type: Boolean,
      default: true
    },

    domains: {
      type: Array,
      default: null,
      validator: function (value) {
        return value !== undefined
      }
    },

    defaultDomain: {
      type: String
    }
  },

  data() {
    return {
      localAddress: '',
      selectedDomain: null
    };
  },

  computed: {
    validAddress() {
      if(!this.localAddress) {
        return null
      }

      if(this.buyAddress) {
        if(!this.selectedDomain) {
          return false
        }
      }

      return this.buyAddress ?
        isValidAddress(`${this.localAddress}@${this.selectedDomain}`) :
        isValidAddress(this.localAddress)
    },

    type() {
      return this.buyAddress ? 'address' : 'domain'
    }
  },

  created() {
    this.localAddress = this.value;
    if(this.defaultDomain) {
      this.selectedDomain = this.defaultDomain
    } else if(this.domains !== null) {
      this.selectedDomain = this.domains[0]
    }

    this.$watch("localAddress", newValue => {
      this.$emit("valid", this.validAddress);
      if(this.validAddress) {
        if(this.buyAddress) {
          this.$emit("input", `${newValue}@${this.selectedDomain}`);
        } else {
          this.$emit("input", newValue);
        }
      } else {
        this.$emit("input", null);
      }
    });

    this.$watch("selectedDomain", newValue => {
      if(this.validAddress) {
        this.$emit("input", `${this.localAddress}@${newValue}`);
      } else {
        this.$emit("input", null);
      }
    });

    this.$watch("domains", newValue => {
      if(newValue !== null) {
        if(this.defaultDomain) {
          this.selectedDomain = this.defaultDomain
        } else {
          this.selectedDomain = newValue[0]
        }
        // Vue.nextTick(() => {
        //   this.focusInput()
        // })
      }
    })
  },
  methods: {
    // focusInput() {
    //   const input = this.$refs[`${this.type}-input`]
    //   if(input) {
    //     input.focus();
    //   }
    // }
  },

  // mounted() {
  //   this.focusInput();
  // },
};
</script>

<style scoped>
.hidden {
  visibility: hidden;
}

#account-group {
  white-space: nowrap;
}
#account-group > * {
  display: inline-block;
  border-top-style: hidden;
  border-right-style: hidden;
  border-left-style: hidden;
  border-bottom-style: hidden;
}
#address-input, #domain-input {
  /* border: 1px dotted; */
  border-bottom-style: groove;
  max-width: 10em;
}
#separator {
  /* font-size: x-large */
}
#domains {
  min-width: 5em;
  background-color: transparent;
  border: 1px dotted;
  border-bottom-style: groove;
}
</style>
